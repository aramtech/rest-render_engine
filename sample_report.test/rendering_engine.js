const fs = (await import("fs")).default;
const path = (await import("path")).default;
const url = (await import("url")).default;
const save = (await import("$/server/utils/render_engine/utils/storage/save.js")).default;
const axios = (await import("axios")).default;
const mimetypes = (await import("mime-types")).default;
const puppeteer = (await import("puppeteer")).default;
const env = (await import("$/server/env.js")).default;

const app_path = env.app_path;

// loaders
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
async function load_images(final_html, resources_root_directory) {
    const image_regex = /(\<img(?:.|\n)*?src\s*?=\s*?(\"|\'))((?:.|\n)*?)(\2(?:.|\n)*?\>)/g;
    // 1-> image start
    // 2-> "
    // 3-> href
    // 4-> image end
    final_html = await replaceAsync(final_html, image_regex, async function () {
        const match = arguments;
        if (match[3]) {
            if (match[3].startsWith("http")) {
                try {
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
                    try {
                        image_buffer = fs.readFileSync(match[3]);
                    } catch (error) {
                        if (error?.errno == -2) {
                            image_buffer = fs.readFileSync(path.join(path.dirname(resources_root_directory), match[3]));
                        } else {
                            throw error;
                        }
                    }
                    if (!image_buffer && !mimetypes.types[path.extname(match[3])]) {
                        throw { errno: -2, error_message: "no image found" };
                    }

                    const dataurl = `data:${mimetypes.types[path.extname(match[3])]};base64,${image_buffer.toString("base64")}`;
                    return `${1}${dataurl}${4}`;
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

// section loader
async function get_sections(html, sections) {
    const res = await html.matchAll(/\$\$\[(.*?)\]\$\$((?:.|\n)*?)\!\!\[\1\]\!\!/gi);
    for (const r of res) {
        if (r[1] && r[2]) {
            sections[r[1]] = r[2];
        }
    }
}

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

async function process(content, sections) {
    let rendered = [];
    if (!Array.isArray(content)) {
        console.log("\n\n Rendering Engine->Skeleton Processor: invalid content of skeleton to process (not an array)", content);
        return "";
    }
    for (const section of content) {
        if (Array.isArray(section)) {
            const subrendered = await process(section);
            rendered = [...rendered, subrendered];
        } else if (typeof section == "object") {
            if (sections[section.type]) {
                const section_template = sections[section.type];
                const result = await render(section, section_template);
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

async function wrap(final_template, html, skeleton) {
    let final_html = html;

    // place body
    final_html = final_html.replaceAll(/(\<body(?:.|\n)*?\>)(?:.|\n)*?(\<\/body\s*?\>)/g, `$1\n${final_template}\n$2`);

    // load style
    async function load_styles(final_html) {
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
                                    css = fs.readFileSync(path.join(path.dirname(skeleton.template), match[3])).toString();
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
    async function load_images(final_html) {
        const image_regex = /(\<img(?:.|\n)*?src\s*?=\s*?(\"|\'))((?:.|\n)*?)(\2(?:.|\n)*?\>)/g;
        // 1-> image start
        // 2-> "
        // 3-> href
        // 4-> image end
        final_html = await replaceAsync(final_html, image_regex, async function () {
            const match = arguments;
            if (match[3]) {
                if (match[3].startsWith("http")) {
                    try {
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
                        try {
                            image_buffer = fs.readFileSync(match[3]);
                        } catch (error) {
                            if (error?.errno == -2) {
                                image_buffer = fs.readFileSync(path.join(path.dirname(skeleton.template), match[3]));
                            } else {
                                throw error;
                            }
                        }
                        if (!image_buffer && !mimetypes.types[path.extname(match[3])]) {
                            throw { errno: -2, error_message: "no image found" };
                        }

                        const dataurl = `data:${mimetypes.types[path.extname(match[3])]};base64,${image_buffer.toString("base64")}`;
                        return `${1}${dataurl}${4}`;
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

    async function load_skeleton_style(final_html) {
        if (typeof skeleton.css == "string") {
            final_html = await final_html.replace(
                "</head>",
                `
        <style>
          ${skeleton.css}
        </style>
      `,
            );
            return final_html;
        } else {
            return final_html;
        }
    }

    if (skeleton.load_css) {
        final_html = await load_styles(final_html);
    }
    if (skeleton.load_images) {
        final_html = await load_images(final_html);
    }
    if (skeleton.css) {
        final_html = await load_skeleton_style(final_html);
    }

    return final_html;
}

async function render(section, section_template) {
    const $ = section;
    const iterator = await section_template.matchAll(
        /(%%if)([1-9]{1,2})?\{((?:.|\n)*?)\}%%((?:.|\n)*?)(?:%%else%%((?:.|\n)*?))?%%endif\2%%|(%%for)([1-9]{1,2})?\<([a-zA-Z\_]+[a-zA-Z\_0-9]*?)(?:\s*?,\s*?([a-zA-Z\_]+[a-zA-Z\_0-9]*?))?\>\{((?:.|\n)*?)\}%%((?:.|\n)*?)%%endfor\7%%|(%%section)([1-9]{1,2})?\<(.*?)\>%%|(\{\{)((?:.|\n)*?)\}\}|((?:.|\n)+?)/gi,
    );

    // 1-> if 2-> id (optional) 3-> js condition -> 4-> content -> 5 -> else
    // 6-> for 7->id 8-> el name 9-> index name 10-> js for statement interator 11-> content
    // 12-> section 13->id  14-> section sub object
    // 15-> js 16-> statement
    // 17 -> string
    let render_string = "";

    for (const match of iterator) {
        if (match[17]) {
            render_string += match[17];
        } else if (match[15]) {
            try {
                const result = await eval(match[16]);
                if (typeof result == "string" || typeof result == "number") {
                    render_string += result;
                }
            } catch (err) {
                console.log("Rendering Engine->Section Renderer: Error on evaluating js statement", match[16], err);
            }
        } else if (match[12]) {
            let subsection;
            try {
                subsection = await eval(match[14]);
                render_string += await process(subsection);
            } catch (error) {
                console.log("Rendering Engine->Section Renderer: Ivalid Section", subsection, error);
            }
        } else if (match[6]) {
            try {
                const element_name = match[8];
                const index_name = match[9];
                const for_iterator = await eval(match[10]);
                if (Array.isArray(for_iterator)) {
                    for (const [i, el] of for_iterator.entries()) {
                        const subsection_object = {};
                        if (index_name) {
                            subsection_object[index_name] = i;
                        }
                        subsection_object[element_name] = el;
                        subsection_object.root = section;
                        const result = await render(subsection_object, match[11]);
                        render_string += result;
                    }
                } else {
                    console.log("Rendering Engine->Section Renderer: for statement evaluation error (not array) \n", match.slice(6, 12));
                }
            } catch (error) {
                console.log("Rendering Engine->Section Renderer: for statement evaluation error \n", match.slice(6, 12), error);
            }
        } else if (match[1]) {
            try {
                const condition_result = await eval(match[3]);
                if (condition_result) {
                    render_string += await render($, match[4]);
                } else {
                    if (match[5]) {
                        render_string += await render($, match[5]);
                    }
                }
            } catch (error) {
                console.log("Rendering Engine->Section Renderer: if statement evaluation error \n", match.slice(1, 6), error);
            }
        }
    }
    return render_string;
}

async function save_files(final_template, skeleton, data) {
    if (skeleton.save && skeleton.save.dir) {
        const files = [];
        if (skeleton.save.data && data) {
            files.push({
                data: JSON.stringify(data, null, 4),
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
                data: final_template,
                name: "rendered_template.html",
                mimetype: "text/html",
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
async function render_skeleton(skeleton, data = null) {
    const sections = {};
    let html = fs.readFileSync(skeleton.template).toString();

    await get_sections(html, sections);

    let final_template;
    final_template = await process(skeleton.content, sections);

    if (skeleton.wrap) {
        final_template = await wrap(final_template, html, skeleton);
    }

    if (skeleton.save) {
        await save_files(final_template, skeleton, data);
    }

    return final_template;
}

async function render_document_from_skeleton(skeleton, data = null) {
    try {
        // standards/constnats
        const _skeleton = skeleton;
        const temporary_path = path.join(template_directory, `temporary_${Date.now()}.html`);
        const paper_map = {
            A4: {
                size: {
                    width: 21,
                    height: 29.7,
                },
            },
        };

        // template html and paths
        function load_template(skeleton) {
            const template_error = Error("Not valid Template name, path is not valid");

            let html;
            let template_index_path;
            let template_directory;

            if (!skeleton.template || typeof skeleton.template != "string") {
                throw template_error;
            }

            if (skeleton.template.match(/^\//)) {
                template_directory = skeleton.template;
            } else {
                template_directory = path.join(app_path, "server", "templates", skeleton.template);
            }
            try {
                const template_stats = fs.statSync(template_directory);
                if (template_stats.isDirectory()) {
                    template_index_path = path.join(template_directory, "index.html");
                } else {
                    template_index_path = template_directory;
                    template_directory = path.dirname(template_directory);
                    if (!template_index_path.match(/\.html$/)) {
                        template_index_path = template_index_path + ".html";
                    }
                }
                html = fs.readFileSync(template_index_path, "utf-8");

                return [html, template_directory, template_index_path];
            } catch (error) {
                throw template_error;
            }
        }
        const [html, template_directory, template_index_path] = load_template(_skeleton);
        _skeleton.html = html;
        _skeleton.template_directory = template_directory;
        _skeleton.template_index_path = template_index_path;
        console.log("template directory:", template_directory);

        // template sections
        async function load_sections(html, sections) {
            const res = await html.matchAll(/\$\$\[(.*?)\]\$\$((?:.|\n)*?)\!\!\[\1\]\!\!/gi);
            for (const r of res) {
                if (r[1] && r[2]) {
                    sections[r[1]] = r[2];
                }
            }
        }
        const sections = {};
        load_sections(html, sections);
        console.log("available template sections: ", Object.keys(sections));
        _skeleton.sections = sections;

        // create puppeteer session
        async function create_puppeteer_session() {
            const puppeteer_session = {};
            puppeteer_session.browser = await puppeteer.launch();
            puppeteer_session.page = await puppeteer_session.browser.newPage();
            return puppeteer_session;
        }
        const puppeteer_session = await create_puppeteer_session();
        _skeleton.puppeteer_session = puppeteer_session;

        // terminate puppeteer session
        async function terminate_puppeteer_session() {
            if (puppeteer_session.browser) {
                await puppeteer_session.browser.close();
                delete puppeteer_session.browser;
                delete puppeteer_session.page;
            }
        }

        async function set_puppeteer_content(html, temporary_full_path = temporary_path, page = puppeteer_session.page) {
            fs.writeFileSync(temporary_full_path, html);
            await page.goto(url.pathToFileURL(temporary_full_path).toString());
        }
        function remove_temp_file(temporary_full_path = temporary_path) {
            if (fs.existsSync(temporary_full_path)) {
                fs.rmSync(temporary_full_path);
            }
        }

        // wrap rendered htmls
        async function wrap(
            rendered_html,
            skeleton = _skeleton,
            options = {
                temp: false,
            },
        ) {
            let final_html = skeleton.html;

            // place body
            final_html = final_html.replace(/(\<body(?:.|\n)*?\>)(?:.|\n)*?(\<\/body\s*?\>)/, `$1\n${rendered_html}\n$2`);

            // place css from skeleton
            async function load_skeleton_style(final_html) {
                if (typeof skeleton.css == "string") {
                    final_html = await final_html.replace(
                        "</head>",
                        `
  <style>
    ${skeleton.css}
  </style>
</head>`,
                    );
                    return final_html;
                } else {
                    return final_html;
                }
            }
            async function place_paper_size(final_html) {
                if (typeof skeleton.css == "string") {
                    final_html = await final_html.replace(
                        "</head>",
                        `
  <style>
      
      @page {
        size: "${skeleton.paper.toUpperCase()}"
      }    
      @media print {
    
        body {
            width: ${paper_map[skeleton.paper.toUpperCase()].size.width}cm;
            height: ${paper_map[skeleton.paper.toUpperCase()].size.height}cm;
        }
    }

    body {
      width: ${paper_map[skeleton.paper.toUpperCase()].size.width}cm;
      height: ${paper_map[skeleton.paper.toUpperCase()].size.height}cm;
    }

  </style>
</head>`,
                    );
                    return final_html;
                } else {
                    return final_html;
                }
            }

            if (skeleton.load_css && !options.temp) {
                final_html = await load_styles(final_html, skeleton.template_directory);
            }
            if (skeleton.load_images && !options.temp) {
                final_html = await load_images(final_html, skeleton.template_directory);
            }
            if (skeleton.css) {
                final_html = await load_skeleton_style(final_html);
            }
            if (typeof skeleton.paper == "string" && paper_map[skeleton.paper.toUpperCase()]) {
                final_html = await place_paper_size(final_html);
            }

            return final_html;
        }

        // height calculator
        async function get_html_height(rendered_html, skeleton = _skeleton) {
            const wrapped_html = await wrap(rendered_html, skeleton, { temp: true });
            await set_puppeteer_content(wrapped_html);
            const height = await skeleton.puppeteer_session.evaluate(() => {
                return window.getComputedStyle(document.querySelector("body")).height;
            });
            return height;
        }

        // section processor
        async function process(content, sections) {
            let rendered = [];
            if (!Array.isArray(content)) {
                console.log("\n\n Rendering Engine->Skeleton Processor: invalid content of skeleton to process (not an array)", content);
                return "";
            }
            for (const section of content) {
                if (Array.isArray(section)) {
                    const subrendered = await process(section);
                    rendered = [...rendered, subrendered];
                } else if (typeof section == "object") {
                    if (sections[section.type]) {
                        const section_template = sections[section.type];
                        const result = await render(section, section_template);
                        if (typeof result == "string" || typeof result == "number") {
                            rendered.push(result);
                        }
                    } else {
                        console.log(
                            "\n\nRendering Engine->Skeleton Processor: invalid section (not fount in sections, \nsection type:)",
                            section.type,
                            "\n",
                            section,
                        );
                    }
                }
            }
            return rendered.join("\n");
        }

        await terminate_puppeteer_session();
        remove_temp_file();
    } catch (error) {
        console.log(error);
    }
}

export default {
    render_skeleton,
    save_files,
    render,
    replaceAsync,
    process_content_of_sections: process,
    wrap,
    load_images,
    load_styles,
};
