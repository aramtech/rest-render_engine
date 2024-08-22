const fs = (await import("fs")).default;
const path = (await import("path")).default;
const url = (await import("url")).default;
const save = (await import("$/server/utils/render_engine/utils/storage/save.js")).default;
const axios = (await import("axios")).default;
const mimetypes = (await import("mime-types")).default;
const puppeteer = (await import("puppeteer")).default;
const env = (await import("$/server/env.js")).default;

const app_path = env.app_path;

const paper_map = {
    A4: {
        size: {
            width: 21,
            height: 29.7,
        },
    },
};

function clean_absolute(path) {
    const return_path = [];
    const parts = path.split("/");
    for (const [i, part] of parts.entries()) {
        if (part == ".") {
            continue;
        } else {
            if (part == "..") {
                return_path.pop();
            } else {
                return_path.push(part);
            }
        }
    }
    return return_path.join("/");
}

// template loader
function load_template(skeleton) {
    const template_error = Error("Not valid Template name, path is not valid");

    let html;
    let template_index_path;
    let template_directory;

    if (typeof skeleton.template != "object" && typeof skeleton.template != "string") {
        throw template_error;
    } else if (typeof skeleton.template == "object" && !skeleton.template.name) {
        throw template_error;
    } else if (typeof skeleton.template == "string") {
        if (!skeleton.template) {
            throw template_error;
        }
        skeleton.template = { name: skeleton.template };
    }

    if (skeleton.template.name.match(/^\//)) {
        template_directory = skeleton.template.name;
    } else {
        template_directory = path.join(app_path, "server", "templates", skeleton.template.name);
    }
    try {
        const template_stats = fs.statSync(template_directory);
        if (template_stats.isDirectory()) {
            template_index_path = path.join(template_directory, "index.html");
        } else {
            template_index_path = template_directory;
            template_directory = path.dirname(template_directory);
        }
        html = fs.readFileSync(template_index_path, "utf-8");

        return [html, template_directory, template_index_path];
    } catch (error) {
        throw template_error;
    }
}

// section loader
async function load_sections(html, sections) {
    const section_regex_matchers = [
        // section $$
        // 1-> section name 2-> sectoin contents
        /\$\$\[(.*?)\]\$\$((?:.|\n)*?)\!\!\[\1\]\!\!/,

        // 3-> section name 4-> section content
        /\<a-define-section\s*?\[(.*?)\]\s*?\>((?:\n|.)*?)\<\/a-define-section\s*?\[\3\]\s*?\>/,
    ];

    const re = RegExp(section_regex_matchers.map((r) => r.toString().slice(1, -1)).join("|"), "gi");
    const res = await html.matchAll(re);
    for (const r of res) {
        if (r[1] && r[2]) {
            sections[r[1]] = r[2];
        } else if (r[3] && r[4]) {
            sections[r[3]] = r[4];
        }
    }
}

// set puppeteer content
async function set_puppeteer_content(html, temporary_full_path, page) {
    fs.writeFileSync(temporary_full_path, html);
    await page.goto(url.pathToFileURL(temporary_full_path).toString());
}
// calculate cm to px ratio
async function calculate_cm_per_px(temporary_path, page) {
    const temp_div = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Temp</title>
      <style>
        @page {
          margin:0cm;
        }
        @media print {
          html, body {
            padding:0px;
            margin:0px;
          }
        }
        html, body {
          padding:0px;
          margin:0px;
        }
        .in_cm{
          height:100cm;
          width:100cm;
        }
      </style>

    </head>
    <body>
        <div class="in_cm" id="incm"></div>
    </body>
  </html>
  `;
    await set_puppeteer_content(temp_div, temporary_path, page);
    const cm_per_px =
        100 /
        parseInt(
            await page.evaluate(() => {
                return window.getComputedStyle(document.querySelector("#incm")).height;
            }),
        );
    return cm_per_px;
}
// create puppeteer session
async function create_puppeteer_session(temporary_path) {
    const puppeteer_session = { temporary_path };
    puppeteer_session.browser = await puppeteer.launch();
    puppeteer_session.page = await puppeteer_session.browser.newPage();
    puppeteer_session.cm_per_px = await calculate_cm_per_px(temporary_path, puppeteer_session.page);
    console.log("cm per px", puppeteer_session.cm_per_px);
    return puppeteer_session;
}

// height calculator
async function get_html_height(rendered_html, skeleton) {
    const wrapped_html = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Temp</title>
      <style>
        @page {
          margin:0cm;
        }
        @media print {
          html, body {
            padding:0px;
            margin:0px;
          }
        }
        html, body {
          padding:0px;
          margin:0px;
        }
      </style>
    </head>
  
    <body>
        ${rendered_html}
    </body>
  </html>
  `;
    await set_puppeteer_content(wrapped_html, skeleton.template.temporary_path, skeleton.puppeteer_session.page);
    const height = await skeleton.puppeteer_session.page.evaluate(() => {
        return window.getComputedStyle(document.querySelector("html")).height;
    });
    return height;
}

// terminate puppeteer session
async function terminate_puppeteer_session(puppeteer_session) {
    if (puppeteer_session.browser) {
        await puppeteer_session.browser.close();
        delete puppeteer_session.browser;
        delete puppeteer_session.page;
    }
}
// remove puppeteer full path
function remove_puppeteer_temp_file(temporary_full_path) {
    if (fs.existsSync(temporary_full_path)) {
        fs.rmSync(temporary_full_path);
    }
}

// render engine
async function render(section, section_template, sections) {
    const $ = section;

    const regex_list = [
        // if %%
        // 1-> if 2-> id 3-> condition 4->if-contnent
        // 5-> else-ifs 6-> else-content
        /(%%if)([1-9]{1,2})?\s*?\{((?:.|\n)*?)\}\s*?%%((?:.|\n)*?)((?:%%else-if\2\s*?\{(?:(?:.|\n)*?)\}\s*?%%(?:(?:.|\n)*?))*?)?(?:%%else\2\s*?%%((?:.|\n)*?))?%%endif\2\s*?%%/,

        // if <
        // 7-> if 8-> id 9-> condition 10->if-contnent
        // 11-> else-ifs 12-> else-content
        /(<a-if)([1-9]{1,2})?\s*?condition\s*?=\s*?(?:\'|\")((?:.|\n)*?)(?:\'|\")\s*?>((?:.|\n)*?)((?:<a-else-if\8\s*?condition\s*?=\s*?(?:\'|\")(?:(?:.|\n)*?)(?:\'|\")\s*?\/?\>(?:(?:.|\n)*?))*?)?(?:<a-else\8\s*?\/?\>((?:.|\n)*?))?<\/a-if\8\s*?>/,

        // for %%
        // 13->for 14->id 15->el_name 16->index_name
        // 17->for_eval 18->content
        /(%%for)([1-9]{1,2})?\s*?\[\s*?([a-zA-Z\_]+[a-zA-Z\_0-9]*?)(?:\s*?,\s*?([a-zA-Z\_]+[a-zA-Z\_0-9]*?))?\s*?\]\s*?\{((?:.|\n)*?)\}\s*?%%((?:.|\n)*?)%%endfor\14\s*?%%/,

        // for <
        // 19->for 20->id 21->el_name 22->index_name
        // 23->for_eval 24->content
        /(<a-for)([1-9]{1,2})?\s*?\[\s*?([a-zA-Z\_]+[a-zA-Z\_0-9]*?)(?:\s*?,\s*?([a-zA-Z\_]+[a-zA-Z\_0-9]*?))?\s*?\]\s*?array\s*?=\s*?(?:\'|\")((?:.|\n)*?)(?:\'|\")\s*?>((?:.|\n)*?)<\/a-for\20\s*?>/,

        // section %%
        // 25-> section 26->id 27->section object
        /(%%section)([1-9]{1,2})?\s*?\[(.*?)\]\s*?%%/,
        // section <
        // 28-> section 29->id 30->section object
        /(<a-section)([1-9]{1,2})?\s*?\[(.*?)\]\s*?\/?>/,

        // style %%
        // 31-> style, 32-> style selector 33-> spread or not
        /(%%style)\s*?(?:\[(.*?)(?:\s*?,\s*?(false|true))?\s*?\])?\s*?%%/,

        // style <
        // 34-> style, 35-> style selector 36-> spread or not
        /(<a-style)\s*?(?:\[(.*?)(?:\s*?,\s*?(false|true))?\s*?\])?\s*?\/>/,

        // js
        // 37->js 38->content to eval
        /(\{\{)((?:.|\n)*?)\}\}/,

        // string
        // 39-> string
        /((?:.|\n)+?)/,
    ];

    const all_regex = RegExp(regex_list.map((r) => r.toString().slice(1, -1)).join("|"), "gi");

    const iterator = await section_template.matchAll(all_regex);

    // else if
    //
    let render_string = "";

    for (const match of iterator) {
        // string
        // 39-> string
        if (match[39]) {
            render_string += match[39];
        }

        // js
        // 37->js 38->content to eval
        else if (match[37]) {
            try {
                const result = await eval(match[38]);
                if (typeof result == "string" || typeof result == "number") {
                    render_string += result;
                }
            } catch (err) {
                console.log("Rendering Engine->Section Renderer: Error on evaluating js statement", match.slice(37, 39), err);
            }
        }

        // style <
        // 34-> style, 35-> style selector 36-> spread or not
        else if (match[34]) {
            let style = "";
            let style_source = {};
            try {
                if (match[35]) {
                    style_source = eval(match[35]);
                } else {
                    style_source = $.style;
                }
                if (typeof style_source == "object") {
                    for (const [key, val] of Object.entries(style_source)) {
                        if (val) {
                            style += `${key.replaceAll("_", "-")}=${val}; `;
                        }
                    }
                } else if (typeof style_source == "string") {
                    style = style_source;
                }
                if (style) {
                    if (match[36] && eval(match[36])) {
                        render_string += ` style="${style}" `;
                    } else {
                        render_string += ` ${style} `;
                    }
                }
            } catch (err) {
                console.log("Rendering Engine->Section Renderer: Error on evaluating style", match.slice(34, 37), err);
            }
        }

        // style %%
        // 31-> style, 32-> style selector 33-> spread or not
        else if (match[31]) {
            let style = "";
            let style_source = {};
            try {
                if (match[32]) {
                    style_source = eval(match[32]);
                } else {
                    style_source = $.style;
                }
                if (!!style_source && typeof style_source == "object") {
                    for (const [key, val] of Object.entries(style_source)) {
                        if (val) {
                            style += `${key.replaceAll("_", "-")}:${val}; `;
                        }
                    }
                } else if (typeof style_source == "string") {
                    style = style_source;
                }
                if (style) {
                    if (match[33] && eval(match[33])) {
                        render_string += ` style="${style}" `;
                    } else {
                        render_string += ` ${style} `;
                    }
                }
            } catch (err) {
                console.log("Rendering Engine->Section Renderer: Error on evaluating style", match.slice(31, 34), err);
            }
        }

        // section <
        // 28-> section 29->id 30->section object
        else if (match[28]) {
            let subsection;
            try {
                subsection = await eval(match[30]);
                render_string += await process(subsection, sections);
            } catch (error) {
                console.log("Rendering Engine->Section Renderer: Ivalid Section", subsection, Object.keys(sections), error);
            }
        }

        // section %%
        // 25-> section 26->id 27->section object
        else if (match[25]) {
            let subsection;
            try {
                subsection = await eval(match[27]);
                render_string += await process(subsection);
            } catch (error) {
                console.log("Rendering Engine->Section Renderer: Ivalid Section", subsection, error);
            }
        }

        // for <
        // 19->for 20->id 21->el_name 22->index_name
        // 23->for_eval 24->content
        else if (match[19]) {
            try {
                const element_name = match[21];
                const index_name = match[22];
                const array = await eval(match[23]);
                if (Array.isArray(array)) {
                    for (const [i, el] of array.entries()) {
                        const subsection_object = {};
                        if (index_name) {
                            subsection_object[index_name] = i;
                        }
                        subsection_object[element_name] = el;
                        subsection_object.root = section;
                        const result = await render(subsection_object, match[24], sections);
                        render_string += result;
                    }
                } else {
                    console.log("Rendering Engine->Section Renderer: for statement evaluation error (not array) \n", match.slice(19, 25));
                }
            } catch (error) {
                console.log("Rendering Engine->Section Renderer: for statement evaluation error \n", match.slice(19, 25), error);
            }
        }

        // for %%
        // 13->for 14->id 15->el_name 16->index_name
        // 17->for_eval 18->content
        else if (match[13]) {
            try {
                const element_name = match[15];
                const index_name = match[16];
                const array = await eval(match[17]);
                if (Array.isArray(array)) {
                    for (const [i, el] of array.entries()) {
                        const subsection_object = {};
                        if (index_name) {
                            subsection_object[index_name] = i;
                        }
                        subsection_object[element_name] = el;
                        subsection_object.root = section;
                        const result = await render(subsection_object, match[18], sections);
                        render_string += result;
                    }
                } else {
                    console.log("Rendering Engine->Section Renderer: for statement evaluation error (not array) \n", match.slice(13, 19));
                }
            } catch (error) {
                console.log("Rendering Engine->Section Renderer: for statement evaluation error \n", match.slice(13, 19), error);
            }
        }

        // if <
        // 7-> if 8-> id 9-> condition 10->if-contnent
        // 11-> else-ifs 12-> else-content
        else if (match[7]) {
            try {
                const condition_result = await eval(match[9]);
                if (condition_result) {
                    render_string += await render($, match[10], sections);
                } else if (match[11]) {
                    // else if regex
                    // 1->condition 2->content
                    const else_ifs_regex = RegExp(
                        `<a-else-if${match[8] || ""}\s*?condition\s*?=\s*?(?:\'|\")((?:.|\n)*?)(?:\'|\")\s*?\/?\>((?:.|\n)*?)(?=\<a\-|$)`,
                        "gi",
                    );
                    const else_ifs = match[11].matchAll(else_ifs_regex);
                    for (const else_if of else_ifs) {
                        if (await eval(else_if[1])) {
                            render_string += await render($, else_if[2], sections);
                            break;
                        }
                    }
                } else if (match[12]) {
                    render_string += await render($, match[12], sections);
                }
            } catch (error) {
                console.log("Rendering Engine->Section Renderer: if statement evaluation error \n", match.slice(7, 13), $, error);
            }
        }

        // if %%
        // 1-> if 2-> id 3-> condition 4->if-contnent
        // 5-> else-ifs 6-> else-content
        else if (match[1]) {
            try {
                const condition_result = await eval(match[3]);
                if (condition_result) {
                    render_string += await render($, match[4], sections);
                } else if (match[5]) {
                    // else if regex
                    // 1->condition 2->content
                    const else_ifs_regex = RegExp(`%%else-if${match[2] || ""}\s*?\{((?:.|\n)*?)\}\s*?%%((?:.|\n)*?)(?=%%|$)`, "gi");
                    const else_ifs = match[5].matchAll(else_ifs_regex);
                    for (const else_if of else_ifs) {
                        if (await eval(else_if[1])) {
                            render_string += await render($, else_if[2], sections);
                            break;
                        }
                    }
                } else if (match[6]) {
                    render_string += await render($, match[6], sections);
                }
            } catch (error) {
                console.log("Rendering Engine->Section Renderer: if statement evaluation error \n", match.slice(1, 7), error);
            }
        }
    }
    return render_string;
}

// process skeleton content
async function process(content, sections) {
    let rendered = [];
    if (!Array.isArray(content)) {
        console.log("\n\n Rendering Engine->Skeleton Processor: invalid content of skeleton to process (not an arra", content);
        return "";
    }
    for (const section of content) {
        if (Array.isArray(section)) {
            const subrendered = await process(section, sections);
            rendered = [...rendered, subrendered];
        } else if (typeof section == "object") {
            if (sections[section.type]) {
                const section_template = sections[section.type];
                const result = await render(section, section_template, sections);
                if (typeof result == "string" || typeof result == "number") {
                    rendered.push(result);
                }
            } else {
                console.log("\n\nRendering Engine->Skeleton Processor: invalid section (not fount in sections, \nsection type:)", section.type, "\n", section);
            }
        }
    }
    return rendered.join("\n");
}

// async replacer
async function replaceAsync(str, regex, asyncFn) {
    const promises = [];
    str.replaceAll(regex, (match, ...args) => {
        const promise = asyncFn(match, ...args);
        promises.push(promise);
    });
    const data = await Promise.all(promises);
    return str.replaceAll(regex, () => {
        return data.shift();
    });
}

// style and image to tags and data urls loaders
async function load_styles(final_html, resources_root_directory) {
    async function load_style_links(final_html) {
        const link_regex =
            /(\<link(?:.|\n)*?href=\s?("|'))(.*?)(\2(?:.|\n)*?rel=\s?("|')stylesheet\5(?:.|\n)*?\>)|(\<link(?:.|\n)*?rel=\s?("|')stylesheet\7(?:.|\n)*?href=\s?("|'))(.*?)(\8(?:.|\n)*?\>)/g;
        final_html = await replaceAsync(final_html, link_regex, async function () {
            const match = arguments;
            if (match[3] || match[9]) {
                if (match[9]) {
                    match[3] = match[9];
                }
                if (match[3].startsWith("http")) {
                    try {
                        const css = await axios.get(match[3]);
                        if (css.headers["content-type"]?.includes("text/css") && typeof css.data == "string") {
                            const style_tag = `
                                        <style type="text/css">
                                            ${css.data}
                                        </style>
                                    `;
                            return style_tag;
                        } else {
                            console.log("Rendering Engine->Wrapper: Unrecognizable content-type", match, { ...css, data: undefined });
                            return match[0];
                        }
                    } catch (err) {
                        console.log("Rendering Engine->Wrapper: Error on fetching CSS HTTP LINK while loading style", match, err);
                        return match[0];
                    }
                } else {
                    try {
                        let css = null;
                        try {
                            css = fs.readFileSync(match[3]).toString();
                        } catch (error) {
                            if (error?.errno == -2) {
                                css = fs.readFileSync(path.join(path.dirname(resources_root_directory), match[3])).toString();
                            } else {
                                throw error;
                            }
                        }

                        if (css) {
                            const style_tag = `
                                        <style type="text/css">
                                            ${css}
                                        </style>
                                    `;
                            return style_tag;
                        } else {
                            console.log("Rendering Engine->Wrapper: Error on fetching CSS FILE LINK, CSS did not load", css, match);
                            return match[0];
                        }
                    } catch (error) {
                        console.log("Rendering Engine->Wrapper: Error on fetching CSS FILE LINK while loading style", match, error);
                        return match[0];
                    }
                }
            } else {
                return match[0];
            }
        });
        return final_html;
    }
    final_html = await load_style_links(final_html);
    return final_html;
}
async function load_images(
    final_html,
    resources_root_directory,
    options = {
        load_images_as_urls: true,
    },
) {
    const image_regex = /(\<img(?:.|\n)*?src\s*?=\s*?(\"|\'))((?:.|\n)*?)(\2(?:.|\n)*?\/?\>)/g;
    // 1-> image start
    // 2-> "
    // 3-> href
    // 4-> image end
    final_html = await replaceAsync(final_html, image_regex, async function () {
        const match = arguments;
        if (match[3]) {
            if (match[3].startsWith("http")) {
                try {
                    if (options?.load_images_as_urls) {
                        return match[0];
                    }
                    const result = await axios({
                        responseType: "arraybuffer",
                        method: "GET",
                        url: match[3],
                    });
                    const dataurl = `data:${result.headers["content-type"]};base64,${result.data.toString("base64")}`;
                    return `${1}${dataurl}${4}`;
                } catch (error) {
                    console.log("Rendering Engine->Wrapper->image loader: error while loading HTTP IMAGE LINK", match, error);
                    return match[0];
                }
            } else {
                try {
                    let image_buffer = null;
                    let file_path;
                    try {
                        image_buffer = fs.readFileSync(match[3]);
                        file_path = match[3];
                    } catch (error) {
                        if (error?.errno == -2) {
                            image_buffer = fs.readFileSync(path.join(resources_root_directory, match[3]));
                            file_path = path.join(resources_root_directory, match[3]);
                        } else {
                            throw error;
                        }
                    }
                    if (!image_buffer || !mimetypes.types[path.extname(match[3]).slice(1)]) {
                        throw { errno: -2, error_message: "no image found" };
                    }
                    if (options?.load_images_as_urls) {
                        const clean_path = clean_absolute(file_path);
                        const public_locals = env.client?.public_dirs?.map((dir) => dir.local);
                        for (const dir of public_locals) {
                            if (clean_path.includes(`/${dir}/`)) {
                                const reg = RegExp(`(?<=${dir}\/).*?$`);
                                console.log(reg);
                                const returnpath =
                                    `${match[1]}http://${env.client.host}/server/${env.client?.public_dirs.filter((el) => el.local == dir)[0].remote}/` +
                                    clean_path.match(reg)[0] +
                                    match[4];
                                console.log(returnpath);
                                return returnpath;
                            }
                        }
                    }

                    const dataurl = `data:${mimetypes.types[path.extname(match[3]).slice(1)]};base64,${image_buffer.toString("base64")}`;
                    return `${match[1]}${dataurl}${match[4]}`;
                } catch (error) {
                    console.log("Rendering Engine->Wrapper->image loader: error while loading FILE IMAGE LINK", match, error);
                    return match[0];
                }
            }
        } else {
            return match[0];
        }
    });
    return final_html;
}

// place css from skeleton
async function load_skeleton_style(final_html, skeleton) {
    if (typeof skeleton.style.css == "string") {
        final_html = await final_html.replace(
            "</head>",
            `
<style>
${skeleton.style.css}
</style>
</head>`,
        );
        return final_html;
    } else {
        return final_html;
    }
}
// place css from wrap
async function load_wrap_style(final_html, css) {
    if (typeof skeleton.style.css == "string") {
        final_html = await final_html.replace(
            "</head>",
            `
<style>
${css}
</style>
</head>`,
        );
        return final_html;
    } else {
        return final_html;
    }
}

// place paper dimentions
async function place_paper_size(final_html, skeleton) {
    if (typeof skeleton.style.paper == "string") {
        final_html = await final_html.replace(
            "</head>",
            `
<style>

@page {
  size: "${skeleton.style.paper.toUpperCase()}"
}

body, html {
  width: ${paper_map[skeleton.style.paper.toUpperCase()].size.width}cm;
  height: ${
      paper_map[skeleton.style.paper.toUpperCase()].size.height -
      (parseFloat(skeleton.template?.margin?.top) || 0) -
      (parseFloat(skeleton.template?.margin?.bottom) || 0)
  }cm;
}

</style>
</head>`,
        );
        return final_html;
    } else {
        return final_html;
    }
}

// wrap rendered htmls
async function wrap(
    rendered_html,
    skeleton,
    options = {
        temp: false,
    },
) {
    let final_html = skeleton.template.html;

    // place body
    final_html = final_html.replace(/(\<body(?:.|\n)*?\>)(?:.|\n)*?(\<\/body\s*?\>)/, `$1\n${rendered_html}\n$2`);

    if (skeleton.style.load_css && !options.temp) {
        final_html = await load_styles(final_html, skeleton.template.template_directory);
    }
    if (skeleton.style.load_images && !options.temp) {
        console.log({
            load_images_as_urls: skeleton.style.load_images_as_urls,
        });
        final_html = await load_images(final_html, skeleton.template.template_directory, {
            load_images_as_urls: skeleton.style.load_images_as_urls,
        });
    }
    if (skeleton.style.css) {
        final_html = await load_skeleton_style(final_html, skeleton);
    }
    if (options?.css) {
        final_html = await load_wrap_style(final_html, options.css);
    }
    if (typeof skeleton.style.paper == "string" && paper_map[skeleton.style.paper.toUpperCase()]) {
        final_html = await place_paper_size(final_html, skeleton);
    }

    return final_html;
}

// generate pdf buffer after renedering
async function generate_pdf_buffer(skeleton) {
    await set_puppeteer_content(
        skeleton.template.wrapped_final_html || skeleton.template.final_template,
        skeleton.template.temporary_path,
        skeleton.puppeteer_session.page,
    );
    const pdf_buffer = await skeleton.puppeteer_session.page.pdf({
        displayHeaderFooter: true,
        footerTemplate: skeleton.template.footer?.html,
        headerTemplate: skeleton.template.header?.html,
        format: skeleton.style.paper,
        margin: skeleton.template.margin,

        // // scale:1,
        // timeout: 120e3,
    });

    return pdf_buffer;
}

// save files
async function save_files(skeleton) {
    if (skeleton.save && skeleton.save.dir) {
        const files = [];
        if (skeleton.save.data && skeleton.data) {
            files.push({
                data: JSON.stringify(skeleton.data, null, 4),
                name: "data.json",
                mimetype: "application/json",
            });
        }
        if (skeleton.save.skeleton) {
            files.push({
                data: JSON.stringify(skeleton, null, 4),
                name: "skeleton.json",
                mimetype: "application/json",
            });
        }
        if (skeleton.save.rendered_template) {
            files.push({
                data: skeleton.template.wrapped_final_html || skeleton.template.final_template,
                name: "rendered_template.html",
                mimetype: "text/html",
            });
        }
        if (skeleton.save.pdf) {
            files.push({
                data: skeleton.template.pdf_buffer,
                name: "doc.pdf",
                mimetype: "application/pdf",
            });
        }
        files.length > 0 &&
            (await save({
                files: files,
                dir: skeleton.save.dir,
                user_id: 1,
                recursive: true,
                overwrite: true,
            }));
    }
}

async function render_skeleton(skeleton) {
    const _skeleton = skeleton;

    // template html and paths
    const [html, template_directory, template_index_path] = load_template(_skeleton);
    const temporary_path = path.join(template_directory, `temporary_${Date.now()}.html`);
    _skeleton.template.html = html;
    _skeleton.template.template_directory = template_directory;
    _skeleton.template.index_path = template_index_path;
    _skeleton.template.temporary_path = temporary_path;
    console.log("template directory:", template_directory);

    // template sections
    const sections = {};
    await load_sections(html, sections);
    console.log("available template sections: ", Object.keys(sections));
    _skeleton.sections = sections;

    // section processor
    _skeleton.template.final_template = await process(_skeleton.content, sections);

    if (_skeleton.style.wrap) {
        _skeleton.template.wrapped_final_html = await wrap(_skeleton.template.final_template, _skeleton, { temp: false });
    }

    if (_skeleton.save) {
        await save_files(_skeleton);
    }

    return _skeleton;
}

async function render_document_from_skeleton(skeleton) {
    try {
        // standards/constnats
        const _skeleton = skeleton;

        _skeleton.template.margin = {
            left: "0.3cm",
            right: "0.3cm",
        };

        // template html and paths
        const [html, template_directory, template_index_path] = load_template(_skeleton);
        const temporary_path = path.join(template_directory, `temporary_${Date.now()}.html`);
        _skeleton.template.html = html;
        _skeleton.template.template_directory = template_directory;
        _skeleton.template.index_path = template_index_path;
        _skeleton.template.temporary_path = temporary_path;
        console.log("template directory:", template_directory);

        // template sections
        const sections = {};
        await load_sections(html, sections);
        console.log("available template sections: ", Object.keys(sections));
        _skeleton.sections = sections;
        // create puppeteer session
        const puppeteer_session = await create_puppeteer_session(temporary_path);
        _skeleton.puppeteer_session = puppeteer_session;

        if (_skeleton.template.header && typeof _skeleton.template.header == "object" && _skeleton.sections[_skeleton.template.header?.section || "header"]) {
            _skeleton.template.header.html = await render(
                _skeleton.template.header,
                _skeleton.sections[_skeleton.template.header?.section || "header"],
                _skeleton.sections,
            );
            _skeleton.template.header.html = await load_images(_skeleton.template.header.html, _skeleton.template.template_directory, {
                load_images_as_urls: skeleton.style.load_images_as_urls,
            });
            _skeleton.template.header.height_in_px = await get_html_height(_skeleton.template.header.html, _skeleton);
            _skeleton.template.header.height_in_cm = parseInt(_skeleton.template.header.height_in_px) * _skeleton.puppeteer_session.cm_per_px;

            console.log("loaded header, header heaight", _skeleton.template.header.height_in_cm);
            _skeleton.template.margin.top = `${(_skeleton.template.header.height_in_cm + 1).toFixed(1)}cm`;
        }

        if (_skeleton.template.footer && typeof _skeleton.template.footer == "object" && _skeleton.sections[_skeleton.template.footer?.section || "footer"]) {
            _skeleton.template.footer.html = await render(
                _skeleton.template.footer,
                _skeleton.sections[_skeleton.template.footer?.section || "footer"],
                _skeleton.sections,
            );
            _skeleton.template.footer.html = await load_images(_skeleton.template.footer.html, _skeleton.template.template_directory, {
                load_images_as_urls: skeleton.style.load_images_as_urls,
            });
            _skeleton.template.footer.height_in_px = await get_html_height(_skeleton.template.footer.html, _skeleton);
            _skeleton.template.footer.height_in_cm = parseInt(_skeleton.template.footer.height_in_px) * _skeleton.puppeteer_session.cm_per_px;

            console.log("loaded footer, footer heaight", _skeleton.template.footer.height_in_cm);
            _skeleton.template.margin.bottom = `${(_skeleton.template.footer.height_in_cm + 1).toFixed(1)}cm`;
        }

        if (!_skeleton.template.margin.top) {
            _skeleton.template.margin.top = "0.3cm";
        }

        if (!_skeleton.template.margin.bottom) {
            _skeleton.template.margin.bottom = "0.3cm";
        }

        // section processor
        _skeleton.template.final_template = await process(_skeleton.content, _skeleton.sections);

        if (_skeleton.style.wrap) {
            _skeleton.template.wrapped_final_html = await wrap(_skeleton.template.final_template, _skeleton, {
                temp: false,
            });
        }

        console.log("generating pdf", _skeleton.template.margin);
        _skeleton.template.pdf_buffer = await generate_pdf_buffer(_skeleton);
        console.log("generated pdf");

        if (_skeleton.save) {
            await save_files(skeleton);
        }

        await terminate_puppeteer_session(_skeleton.puppeteer_session);
        remove_puppeteer_temp_file(temporary_path);

        return _skeleton;
    } catch (error) {
        console.log("Document Render Error:", error);
    }
}

export default {
    render_skeleton,
    save_files,
    render,
    replaceAsync,
    process_content_of_sections: process,
    render_document_from_skeleton,
    wrap,
    load_images,
    load_styles,
};
