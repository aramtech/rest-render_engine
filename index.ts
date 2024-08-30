const fs = (await import("fs")).default;
const path = (await import("path")).default;
const url = (await import("url")).default;
const save = (await import("$/server/utils/storage/save.js")).default;
const axios = (await import("axios")).default;
const mimetypes = (await import("mime-types")).default;
const puppeteer = (await import("puppeteer")).default;
import env from "$/server/env.json" assert { type: "json" };
const log_util = await import("$/server/utils/log/index.js");


const log = await log_util.local_log_decorator("RENDER-ENGINE", "yellow", true, "Info", true);

const app_path = path.resolve(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "../../../."));

const global_temporary_html_file = url.fileURLToPath(new URL(`../../../temporary_html.html`, import.meta.url));

interface Paper {
    size: { width: number; height: number };
}
const paper_map: PapersSizes = {
    A4: {
        size: {
            width: 21,
            height: 29.7,
        },
    },
};

/**
 * cleans path for example if you give it "path/to/../unclean/./directory" returns "path/unclean/directory"
 *
 *
 */
function clean_absolute(path: string): string {
    const return_path: string[] = [];
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

/**
 *
 * @param {DocumentSkeleton} skeleton
 * @returns {[Html, DirectoryPath, FilePath]} html content of template, directory path of template, index file path of template
 */
// template loader
function load_template(skeleton: DocumentSkeleton): [Html, DirectoryPath, FilePath] {
    const template_error = Error("Not valid Template name, path is not valid");

    let html: string;
    let template_index_path: string;
    let template_directory: string;

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

    if (skeleton.template.name?.match(/^\//)) {
        template_directory = skeleton.template.name;
    } else {
        template_directory = url.fileURLToPath(
            new url.URL(path.join("../../templates", skeleton.template.name || ""), import.meta.url),
        );
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

/**
 *
 * @param {Array<RegExp>} regex_array
 * @param {"gi"|"g"|"i"} [flags]
 * @returns {RegExp}
 */
function regex_array_to_regex(regex_array: Array<RegExp>, flags?: "gi" | "g" | "i"): RegExp {
    return RegExp(regex_array.map((r) => r.toString().slice(1, -1)).join("|"), flags || "gi");
}

async function load_sections(html: Html, sections: Promise<Sections>) {
    const section_regex_matchers: Array<RegExp> = [
        // section $$
        // 1-> section name 2-> sectoin contents
        /\$\$\[(.*?)\]\$\$((?:.|\n)*?)\!\!\[\1\]\!\!/,

        // 3-> section name 4-> section content
        // @ts-ignore
        /\<a-define-section\s*?\[(.*?)\]\s*?\>((?:\n|.)*?)\<\/a-define-section\s*?\[\3\]\s*?\>/,
    ];

    const re = regex_array_to_regex(section_regex_matchers);
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
/**
 * sets the content of the puppeteer page
 *
 */
async function set_puppeteer_content(html: Html, temporary_full_path: FilePath, page: import("puppeteer").Page) {
    fs.writeFileSync(temporary_full_path, html);
    await page.goto(url.pathToFileURL(temporary_full_path).toString(), { timeout: 10e6 });
}

async function calculate_cm_per_px(
    temporary_path: FilePath,
    page: import("puppeteer").Page,
): Promise<[number, number]> {
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
                // @ts-ignore
                return window.getComputedStyle(document.querySelector("#incm")).height;
            }),
        );
    const cm_per_px_approx =
        110 /
        parseInt(
            await page.evaluate(() => {
                // @ts-ignore
                return window.getComputedStyle(document.querySelector("#incm")).height;
            }),
        );
    return [cm_per_px, cm_per_px_approx];
}

let global_session = null as null | PuppeteerSession;
/**
 *
 * @param {FilePath} temporary_path
 * @returns {Promise<PuppeteerSession>}
 */
async function create_puppeteer_session(
    temporary_path: FilePath = global_temporary_html_file,
): Promise<PuppeteerSession> {
    if (global_session) {
        return global_session;
    }
    console.log("creating puppeteer session");
    const puppeteer_session: PuppeteerSession = { temporary_path };
    puppeteer_session.browser =
        // fs.existsSync("/usr/bin/google-chrome")
        // ? await puppeteer.launch()
        // :
        await puppeteer.launch({
            executablePath: env.puppeteer.bin,
            args: env.puppeteer.args,
            timeout: 1000e3,
        });
    puppeteer_session.page = await puppeteer_session.browser?.newPage();
    const cms = await calculate_cm_per_px(temporary_path, puppeteer_session.page);
    puppeteer_session.cm_per_px = cms[1];
    puppeteer_session.real_cm_per_px = cms[0];

    return puppeteer_session;
}
if (env.puppeteer.allow) {
    global_session = await create_puppeteer_session();
}
/**
 * returns html height
 * @param {Html} rendered_html
 * @param {RenderedDocumentSkeleton} skeleton
 * @returns {Promise<number>} html heigth
 */
async function get_html_height(rendered_html: Html, skeleton: RenderedDocumentSkeleton): Promise<number | null> {
    if (skeleton.no_puppeteer || !env.puppeteer.allow) {
        return null;
    }
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
    if (skeleton.puppeteer_session.page) {
        await set_puppeteer_content(
            wrapped_html,
            skeleton.template.temporary_path || "",
            skeleton.puppeteer_session.page,
        );
    }
    const height = await skeleton.puppeteer_session.page?.evaluate(() => {
        // @ts-ignore
        return window.getComputedStyle(document.querySelector("html")).height;
    });
    return height;
}

/**
 * closes puppeteer session
 * @param {Promise<PuppeteerSession>} puppeteer_session
 */
async function terminate_puppeteer_session(puppeteer_session: PuppeteerSession) {
    if (global_session) {
        return;
    }
    if (puppeteer_session.browser) {
        await puppeteer_session.browser.close();
        delete puppeteer_session.browser;
        delete puppeteer_session.page;
    }
}

/**
 * delete file if exists
 * @param {FilePath} temporary_full_path
 */
function remove_puppeteer_temp_file(temporary_full_path: FilePath) {
    if (fs.existsSync(temporary_full_path)) {
        fs.rmSync(temporary_full_path);
    }
}

const regex_list = [
    // if %%
    // 1-> if 2-> id 3-> condition 4->if-content
    // 5-> else-ifs 6-> else-content
    /(%%if)([1-9]{1,2})?\s*?\{((?:.|\n)*?)\}\s*?%%((?:.|\n)*?)((?:%%else-if\2\s*?\{(?:(?:.|\n)*?)\}\s*?%%(?:(?:.|\n)*?))*?)?(?:%%else\2\s*?%%((?:.|\n)*?))?%%endif\2\s*?%%/,

    // if <
    // 7-> if 8-> id 9-> condition 10->if-content
    // 11-> else-ifs 12-> else-content
    // @ts-ignore
    /(<a-if)([1-9]{1,2})?\s*?condition\s*?=\s*?(?:\'|\")((?:.|\n)*?)(?:\'|\")\s*?>((?:.|\n)*?)((?:<a-else-if\8\s*?condition\s*?=\s*?(?:\'|\")(?:(?:.|\n)*?)(?:\'|\")\s*?\/?\>(?:(?:.|\n)*?))*?)?(?:<a-else\8\s*?\/?\>((?:.|\n)*?))?<\/a-if\8\s*?>/,

    // for %%
    // 13->for 14->id 15->el_name 16->index_name
    // 17->for_eval 18->content
    // @ts-ignore
    /(%%for)([1-9]{1,2})?\s*?\[\s*?([a-zA-Z\_]+[a-zA-Z\_0-9]*?)(?:\s*?,\s*?([a-zA-Z\_]+[a-zA-Z\_0-9]*?))?\s*?\]\s*?\{((?:.|\n)*?)\}\s*?%%((?:.|\n)*?)%%endfor\14\s*?%%/,

    // for <
    // 19->for 20->id 21->el_name 22->index_name
    // 23->for_eval 24->content
    // @ts-ignore
    /(<a-for)([1-9]{1,2})?\s*?\[\s*?([a-zA-Z\_]+[a-zA-Z\_0-9]*?)(?:\s*?,\s*?([a-zA-Z\_]+[a-zA-Z\_0-9]*?))?\s*?\]\s*?array\s*?=\s*?(?:\'|\")((?:.|\n)*?)(?:\'|\")\s*?>((?:.|\n)*?)<\/a-for\20\s*?>/,

    // section %%
    // 25-> section 26->id 27->section object
    /(%%section)([1-9]{1,2})?\s*?\[(.*?)\]\s*?%%/,
    // section <
    // 28-> section 29->id 30->section object
    /(<a-section)([1-9]{1,2})?\s*?\[(.*?)\]\s*?\/?>/,

    // style %%
    // 31-> style, 32-> style selector 33-> spread or not
    /(%%style)\s*?(?:\[((?:.|\n)*?)(?:\s*?,\s*?(false|true))\s*?\])?\s*?%%/,

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

const all_regex = regex_array_to_regex(regex_list, "gi");

// render engine
/**
 *
 * @param {SectionDescriptor} section
 * @param {Section} section_template
 * @param {Sections} sections
 * @returns {Promise<Html>}
 */
async function render(section: SectionDescriptor, section_template: Section, sections: Sections): Promise<Html> {
    const $ = section;

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
                log.error(
                    "Rendering Engine->Section Renderer: Error on evaluating js statement",
                    match.slice(37, 39),
                    err,
                );
            }
        }

        // style <
        // 34-> style, 35-> style selector 36-> spread or not
        else if (match[34]) {
            let style = "";
            let style_source = {} as any;
            try {
                if (match[35]) {
                    style_source = eval(match[35]);
                } else {
                    style_source = $.style;
                }
                if (typeof style_source == "object") {
                    for (const [key, val] of Object.entries(style_source)) {
                        if (val) {
                            style += `${key.replaceAll("_", "-")}:${val}; `;
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
                log.error("Rendering Engine->Section Renderer: Error on evaluating style", match.slice(34, 37), err);
            }
        }

        // style %%
        // 31-> style, 32-> style selector 33-> spread or not
        else if (match[31]) {
            let style = "";
            let style_source = {} as any;
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
                log.error("Rendering Engine->Section Renderer: Error on evaluating style", match.slice(31, 34), err);
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
                log.error(
                    "Rendering Engine->Section Renderer: Ivalid Section",
                    subsection,
                    Object.keys(sections),
                    error,
                );
            }
        }

        // section %%
        // 25-> section 26->id 27->section object
        else if (match[25]) {
            let subsection;
            try {
                subsection = await eval(match[27]);
                render_string += await process(subsection, sections);
            } catch (error) {
                log.error("Rendering Engine->Section Renderer: Ivalid Section", subsection, error);
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
                        const subsection_object = {} as any;
                        if (index_name) {
                            subsection_object[index_name] = i;
                        }
                        subsection_object[element_name] = el;
                        subsection_object.root = section;
                        const result = await render(subsection_object, match[24], sections);
                        render_string += result;
                    }
                } else {
                    log.error(
                        "Rendering Engine->Section Renderer: for statement evaluation error (not array) \n",
                        match.slice(19, 25),
                    );
                }
            } catch (error) {
                log.error(
                    "Rendering Engine->Section Renderer: for statement evaluation error \n",
                    match.slice(19, 25),
                    error,
                );
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
                        const subsection_object = {} as any;
                        if (index_name) {
                            subsection_object[index_name] = i;
                        }
                        subsection_object[element_name] = el;
                        subsection_object.root = section;
                        const result = await render(subsection_object, match[18], sections);
                        render_string += result;
                    }
                } else {
                    log.error(
                        "Rendering Engine->Section Renderer: for statement evaluation error (not array) \n",
                        match.slice(13, 19),
                    );
                }
            } catch (error) {
                log.error(
                    "Rendering Engine->Section Renderer: for statement evaluation error \n",
                    match.slice(13, 19),
                    error,
                );
            }
        }

        // if <
        // 7-> if 8-> id 9-> condition 10->if-content
        // 11-> else-ifs 12-> else-content
        else if (match[7]) {
            try {
                const condition_result = await eval(match[9]);
                let condition_satisfied = false;
                if (condition_result) {
                    condition_satisfied = true;
                    render_string += await render($, match[10], sections);
                }
                if (match[11] && !condition_satisfied) {
                    // else if regex
                    // 1->condition 2->content
                    const else_ifs_regex = RegExp(
                        `<a-else-if${
                            match[8] || ""
                        }\s*?condition\s*?=\s*?(?:\'|\")((?:.|\n)*?)(?:\'|\")\s*?\/?\>((?:.|\n)*?)(?=\<a\-|$)`,
                        "gi",
                    );
                    const else_ifs = match[11].matchAll(else_ifs_regex);
                    for (const else_if of else_ifs) {
                        if (await eval(else_if[1])) {
                            render_string += await render($, else_if[2], sections);
                            condition_satisfied = true;
                            break;
                        }
                    }
                }
                if (match[12] && !condition_satisfied) {
                    render_string += await render($, match[12], sections);
                }
            } catch (error) {
                log.error(
                    "Rendering Engine->Section Renderer: if statement evaluation error \n",
                    match.slice(7, 13),
                    $,
                    error,
                );
            }
        }

        // if %%
        // 1-> if 2-> id 3-> condition 4->if-content
        // 5-> else-ifs 6-> else-content
        else if (match[1]) {
            try {
                const condition_result = await eval(match[3]);
                let condition_satisfied = false;
                if (condition_result) {
                    condition_satisfied = true;
                    render_string += await render($, match[4], sections);
                }
                if (match[5] && !condition_satisfied) {
                    // else if regex
                    // 1->condition 2->content
                    const else_ifs_regex = RegExp(
                        `%%else-if${match[2] || ""}\s*?\{((?:.|\n)*?)\}\s*?%%((?:.|\n)*?)(?=%%|$)`,
                        "gi",
                    );
                    const else_ifs = match[5].matchAll(else_ifs_regex);
                    for (const else_if of else_ifs) {
                        if (await eval(else_if[1])) {
                            condition_satisfied = true;
                            render_string += await render($, else_if[2], sections);
                            break;
                        }
                    }
                }
                if (match[6] && !condition_satisfied) {
                    render_string += await render($, match[6], sections);
                }
            } catch (error) {
                log.error(
                    "Rendering Engine->Section Renderer: if statement evaluation error \n",
                    match.slice(1, 7),
                    error,
                );
            }
        }
    }
    return render_string;
}

/**
 *
 * @param {Content} content
 * @param {Sections} sections
 * @returns {Promise<Html>}
 */
async function process(content: Content, sections: Sections): Promise<Html> {
    let rendered: string[] = [];
    if (!Array.isArray(content)) {
        log.warning(
            "\n\n Rendering Engine->Skeleton Processor: invalid content of skeleton to process (not an array",
            content,
            ")",
        );
        return "";
    }
    for (const section of content) {
        if (Array.isArray(section)) {
            const sub_rendered = await process(section, sections);
            rendered = [...rendered, sub_rendered];
        } else if (typeof section == "object") {
            if (section.type && sections[section.type]) {
                const section_template = sections[section.type];
                const result = await render(section, section_template, sections);
                if (typeof result == "string" || typeof result == "number") {
                    rendered.push(result);
                }
            } else {
                log.warning(
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

/**
 * async replacer
 * @param {string} str
 * @param {RegExp} regex
 * @param {async function} asyncFn
 * @returns {Promise<string>}
 */
async function replaceAsync(str: string, regex: RegExp, asyncFn): Promise<string> {
    const promises: Promise<any>[] = [];
    str.replaceAll(regex, (match, ...args) => {
        const promise = asyncFn(match, ...args);
        promises.push(promise);
        return "";
    });
    const data = await Promise.all(promises);
    return str.replaceAll(regex, () => {
        return data.shift();
    });
}

/**
 * style and image to tags and data urls loaders
 * @param {Html} final_html
 * @param {DirectoryPath} resources_root_directory where the css files exists
 * @returns {Promise<Html>}
 */
async function load_styles(final_html: Html, resources_root_directory: DirectoryPath): Promise<Html> {
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
                            log.warning("Rendering Engine->Wrapper: Unrecognizable content-type", match, {
                                ...css,
                                data: undefined,
                            });
                            return match[0];
                        }
                    } catch (err) {
                        log.warning(
                            "Rendering Engine->Wrapper: Error on fetching CSS HTTP LINK while loading style",
                            match,
                            err,
                        );
                        return match[0];
                    }
                } else {
                    try {
                        let css = null as null | string;
                        try {
                            css = fs.readFileSync(match[3]).toString();
                        } catch (error: any) {
                            if (error?.errno == -2) {
                                css = fs
                                    .readFileSync(path.join(path.dirname(resources_root_directory), match[3]))
                                    .toString();
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
                            log.warning(
                                "Rendering Engine->Wrapper: Error on fetching CSS FILE LINK, CSS did not load",
                                css,
                                match,
                            );
                            return match[0];
                        }
                    } catch (error) {
                        log.warning(
                            "Rendering Engine->Wrapper: Error on fetching CSS FILE LINK while loading style",
                            match,
                            error,
                        );
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

/**
 *
 * @param {Html} final_html
 * @param {DirectoryPath} resources_root_directory  where the images exists
 * @param {{load_images_as_urls:Boolean}} options
 * @returns {Promise<Html>}
 */
async function load_images(
    final_html: Html,
    resources_root_directory: DirectoryPath,
    options: { load_images_as_urls: boolean } = {
        load_images_as_urls: true,
    },
): Promise<Html> {
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
                    return `${match[1]}${dataurl}${match[4]}`;
                } catch (error) {
                    log.warning(
                        "Rendering Engine->Wrapper->image loader: error while loading HTTP IMAGE LINK",
                        match,
                        error,
                    );
                    return match[0];
                }
            } else {
                try {
                    let image_buffer = null as Buffer | null;
                    let file_path;
                    try {
                        image_buffer = fs.readFileSync(match[3]);
                        file_path = match[3];
                    } catch (error: any) {
                        if (error?.errno == -2) {
                            file_path = path.join(resources_root_directory, match[3]);
                            image_buffer = fs.readFileSync(file_path);
                        } else {
                            throw error;
                        }
                    }
                    if (!image_buffer || !mimetypes.types[path.extname(match[3]).slice(1)]) {
                        throw { errno: -2, error_message: "no image found" };
                    }
                    if (options?.load_images_as_urls) {
                        const clean_path = clean_absolute(file_path);
                        const public_locals = env.public_dirs?.map((dir) => dir.local);
                        for (const dir of public_locals) {
                            if (clean_path.includes(`/${dir}/`)) {
                                const reg = RegExp(`(?<=${dir}\/).*?$`);
                                const return_path =
                                    `${match[1]}http://${env.host.domain_name}/server/${
                                        env.public_dirs.filter((el) => el.local == dir)[0].remote
                                    }/` +
                                    clean_path.match(reg)?.[0] +
                                    match[4];
                                return return_path;
                            }
                        }
                    }

                    const dataurl = `data:${
                        mimetypes.types[path.extname(match[3]).slice(1)]
                    };base64,${image_buffer.toString("base64")}`;
                    return `${match[1]}${dataurl}${match[4]}`;
                } catch (error) {
                    log.warning(
                        "Rendering Engine->Wrapper->image loader: error while loading FILE IMAGE LINK",
                        match,
                        error,
                    );
                    return match[0];
                }
            }
        } else {
            return match[0];
        }
    });
    return final_html;
}

/**
 *  place css from skeleton
 *
 * @param {Html} final_html
 * @param {RenderedDocumentSkeleton} skeleton
 * @returns {Proimse<Html>}
 */
async function load_skeleton_style(final_html: Html, skeleton: RenderedDocumentSkeleton): Promise<Html> {
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

/**
 * place Css String into rendered Html
 * @param {Html} final_html
 * @param {Css} css
 * @returns
 */
async function load_wrap_style(final_html: Html, css: Css) {
    final_html = await final_html.replace(
        "</head>",
        `
<style>
${css}
</style>
</head>`,
    );
    return final_html;
}

// place paper dimensions
/**
 *
 * @param {Html} final_html
 * @param {RenderedDocumentSkeleton} skeleton
 * @returns
 */
async function place_paper_size(final_html: Html, skeleton: RenderedDocumentSkeleton) {
    if (typeof skeleton.style.paper == "string") {
        final_html = await final_html.replace(
            "</head>",
            `
<style>

    @page {
        size: "${skeleton.style.paper.toUpperCase()}";
        margin-top: ${skeleton.template?.margin?.top};
        margin-bottom: ${skeleton.template?.margin?.bottom};
    }

    body, html {
    width: ${paper_map[skeleton.style.paper.toUpperCase()].size.width}cm;
    height: ${
        paper_map[skeleton.style.paper.toUpperCase()].size.height -
        (Number(skeleton.template?.margin?.top) || 0) -
        (Number(skeleton.template?.margin?.bottom) || 0)
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
/**
 *
 * @param {Html} rendered_html
 * @param {RenderedDocumentSkeleton} skeleton
 * @param {{temp:Boolean, css:Css}} options
 * @returns {Promise<Html>}
 */
async function wrap(
    rendered_html: Html,
    skeleton: RenderedDocumentSkeleton,
    options: { temp: boolean; css: Css } = {
        temp: false,
        css: "",
    },
): Promise<Html> {
    let final_html = skeleton.template.html;
    if (!final_html) {
        return "";
    }
    // place body
    final_html = final_html?.replace(/(\<body(?:.|\n)*?\>)(?:.|\n)*?(\<\/body\s*?\>)/, `$1\n${rendered_html}\n$2`);

    if (skeleton.style.load_css && !options.temp) {
        final_html = await load_styles(final_html, skeleton.template.template_directory || "");
    }
    if (skeleton.style.load_images && !options.temp) {
        final_html = await load_images(final_html, skeleton.template.template_directory || "", {
            load_images_as_urls: skeleton.style.load_images_as_urls,
        });
    }
    if (options?.css) {
        final_html = await load_wrap_style(final_html, options.css);
    }
    if (typeof skeleton.style.paper == "string" && paper_map[skeleton.style.paper.toUpperCase()]) {
        final_html = await place_paper_size(final_html, skeleton);
    }

    if (skeleton.style.css) {
        final_html = await load_skeleton_style(final_html, skeleton);
    }
    return final_html;
}

// generate pdf buffer after renedering
async function generate_pdf_buffer(skeleton: RenderedDocumentSkeleton) {
    const page = skeleton.puppeteer_session.page;

    if (skeleton.template.last_page_footer) {
        const cm_per_px = skeleton.puppeteer_session.real_cm_per_px;
        const height_in_px = await get_html_height(skeleton.template.wrapped_final_html || "", skeleton);
        const height = (cm_per_px || 0) * Math.floor(height_in_px || 0) + 1.5;

        const last_page_footer_initial = await render(
            skeleton.template.last_page_footer,
            skeleton.sections[
                (skeleton as any).template.last_page_footer?.section || skeleton.template.last_page_footer?.type || "div"
            ],
            skeleton.sections,
        );

        const last_page_footer_initial_height_in_px = await get_html_height(last_page_footer_initial, skeleton);
        const last_page_footer_initial_height = Number(cm_per_px) * Math.floor(last_page_footer_initial_height_in_px || 0);

        const one_page_height =
            paper_map[skeleton.style.paper.toUpperCase()].size.height -
            (Number(skeleton.template?.margin?.top) || 0) -
            (Number(skeleton.template?.margin?.bottom) || 0) +
            1;

        const full_page_height = paper_map[skeleton.style.paper.toUpperCase()].size.height;

        const number_of_pages = Math.ceil((height + last_page_footer_initial_height) / one_page_height);
        const page_rest = number_of_pages * full_page_height - height;
        const margin_top = page_rest - last_page_footer_initial_height;
        const full_height = height + last_page_footer_initial_height;

        skeleton.template.wrapped_final_html = await load_wrap_style(
            skeleton.template.wrapped_final_html || "",
            `
            body, html {
                position: relative;
                height: ${(number_of_pages * one_page_height).toFixed(2)}cm;
            }    

        `,
        );
        const last_page_footer = await render(
            skeleton.template.last_page_footer,
            skeleton.sections[
                (skeleton as any).template.last_page_footer?.section || skeleton.template.last_page_footer?.type || "div"
            ],
            skeleton.sections,
        );

        skeleton.template.wrapped_final_html = skeleton.template.wrapped_final_html.replace(
            /\<\/body\>/,
            `
                ${last_page_footer}
            </body>
        `,
        );
    }

    await set_puppeteer_content(
        skeleton.template.wrapped_final_html || skeleton.template.final_template || "",
        skeleton.template.temporary_path || "",
        skeleton.puppeteer_session.page as any,
    );

    const pdf_buffer= await page?.pdf({
        displayHeaderFooter: true,
        footerTemplate: skeleton.template.footer?.html,
        headerTemplate: skeleton.template.header?.html,
        format: skeleton.style.paper,
        margin: skeleton.template.margin,

        // // scale:1,
        timeout: 600e3,
    });

    return pdf_buffer as Buffer;
}

/**
 *
 * @param {RenderedDocumentSkeleton} skeleton
 */
async function save_files(skeleton: RenderedDocumentSkeleton) {
    if (skeleton.save && skeleton.save.dir) {
        /**
         * @type {Array<import("$/server/utils/storage/save.js").File>}
         */
        const files: Array<import("$/server/utils/storage/save.js").File> = [];
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
                data: skeleton.template.wrapped_final_html || skeleton.template.final_template || "",
                name: "rendered_template.html",
                mimetype: "text/html",
            });
        }
        if (skeleton.save.pdf && skeleton.template.pdf_buffer) {
            files.push({
                data: skeleton.template.pdf_buffer,
                name: "doc.pdf",
                mimetype: "application/pdf",
            });
        }
        files.length > 0 &&
            (skeleton.files = (
                await save({
                    files: files,
                    dir: skeleton.save.dir,
                    user_id: "1",
                    recursive: true,
                    overwrite: true,
                })
            ).map((file) => file.path));
    }
}

/**
 *
 * @param {DocumentSkeleton} skeleton
 * @returns {RenderedDocumentSkeleton}
 */
async function render_skeleton(skeleton: DocumentSkeleton): Promise<RenderedDocumentSkeleton> {
    const _skeleton: RenderedDocumentSkeleton = skeleton as any;

    // template html and paths
    const [html, template_directory, template_index_path] = load_template(_skeleton);
    const temporary_path = global_temporary_html_file; //path.join(template_directory, `temporary_${Date.now()}.html`);
    _skeleton.template.html = html;
    _skeleton.template.template_directory = template_directory;
    _skeleton.template.index_path = template_index_path;
    _skeleton.template.temporary_path = temporary_path;
    console.log("template directory:", template_directory);

    // template sections
    const sections = {} as any;
    await load_sections(html, sections);
    console.log("available template sections: ", Object.keys(sections));
    _skeleton.sections = sections;

    // section processor
    _skeleton.template.final_template = await process(_skeleton.content, sections);

    if (_skeleton.style.wrap) {
        _skeleton.template.wrapped_final_html = await wrap(_skeleton.template.final_template, _skeleton, {
            temp: false,
            css: "",
        });
    }

    if (_skeleton.save) {
        await save_files(_skeleton);
    }

    return _skeleton;
}

const default_margin_top = "0.3cm";
const default_margin_bottom = "0.3cm";

/**
 *
 * @param {DocumentSkeleton} skeleton
 * @returns {Promise<RenderedDocumentSkeleton>}
 */
async function render_document_from_skeleton(
    skeleton: DocumentSkeleton,
    new_page = true,
): Promise<RenderedDocumentSkeleton | undefined> {
    try {
        let start_time = Date.now();

        const _skeleton: RenderedDocumentSkeleton = skeleton as any;

        if (!_skeleton.template.margin) {
            _skeleton.template.margin = {} as any;
        }

        // template html and paths
        const [html, template_directory, template_index_path] = load_template(_skeleton);
        _skeleton.template.html = html;
        _skeleton.template.template_directory = template_directory;
        _skeleton.template.index_path = template_index_path;

        // template sections
        const sections = {} as any;
        await load_sections(html, sections);
        log("available template sections: ", Object.keys(sections));
        _skeleton.sections = sections;

        // create puppeteer session
        if (!_skeleton.no_puppeteer && env.puppeteer.allow) {
            _skeleton.template.temporary_path = global_temporary_html_file;
            const puppeteer_session = await create_puppeteer_session();
            if (new_page) {
                puppeteer_session.page = await puppeteer_session.browser?.newPage();
            }
            _skeleton.puppeteer_session = puppeteer_session;
        }

        if (
            _skeleton.template.header &&
            typeof _skeleton.template.header == "object" &&
            _skeleton.sections[_skeleton.template.header?.section || "header"]
        ) {
            _skeleton.template.header.html = await render(
                _skeleton.template.header,
                _skeleton.sections[_skeleton.template.header?.section || "header"],
                _skeleton.sections,
            );
            _skeleton.template.header.html = await load_images(
                _skeleton.template.header.html,
                _skeleton.template.template_directory,
                {
                    load_images_as_urls: skeleton.style.load_images_as_urls,
                },
            );
            _skeleton.template.header.height_in_px =
                _skeleton.template.header.height_in_px ||
                (await get_html_height(_skeleton.template.header.html, _skeleton)) ||
                0;
            _skeleton.template.header.height_in_cm =
                _skeleton.template.header.height_in_cm ||
                Math.floor(_skeleton.template.header.height_in_px || 0) *
                    (_skeleton.template.cm_per_px || _skeleton.puppeteer_session?.cm_per_px || 0);

            log("loaded header, header height", _skeleton.template.header.height_in_cm);
            (_skeleton as any).template.margin.top =
                _skeleton.template.margin?.top ||
                `${(_skeleton.template.header.height_in_cm + 0.6).toFixed(1)}cm` ||
                default_margin_top;
        }
        if (
            _skeleton.template.footer &&
            typeof _skeleton.template.footer == "object" &&
            _skeleton.sections[_skeleton.template.footer?.section || "footer"]
        ) {
            _skeleton.template.footer.html = await render(
                _skeleton.template.footer,
                _skeleton.sections[_skeleton.template.footer?.section || "footer"],
                _skeleton.sections,
            );
            _skeleton.template.footer.html = await load_images(
                _skeleton.template.footer.html,
                _skeleton.template.template_directory,
                {
                    load_images_as_urls: skeleton.style.load_images_as_urls,
                },
            );

            _skeleton.template.footer.height_in_px =
                _skeleton.template.footer.height_in_px ||
                (await get_html_height(_skeleton.template.footer.html, _skeleton)) ||
                0;
            _skeleton.template.footer.height_in_cm =
                _skeleton.template.footer.height_in_cm ||
                Math.floor(_skeleton.template.footer.height_in_px) *
                    (_skeleton.template.cm_per_px || _skeleton.puppeteer_session?.cm_per_px || 0);

            (_skeleton as any).template.margin.bottom =
                _skeleton.template.margin?.bottom ||
                `${(_skeleton.template.footer.height_in_cm + 0.6).toFixed(1)}cm` ||
                default_margin_bottom;
        }

        // section processor
        _skeleton.template.final_template = await process(_skeleton.content, _skeleton.sections);

        if (_skeleton.style.wrap) {
            _skeleton.template.wrapped_final_html = await wrap(_skeleton.template.final_template, _skeleton, {
                temp: false,
                css: "",
            });
        }
        if (!_skeleton.no_puppeteer && env.puppeteer.allow && _skeleton.save?.pdf) {
            log("generating pdf", _skeleton.template.margin);
            _skeleton.template.pdf_buffer = await generate_pdf_buffer(_skeleton);
            log("generated pdf");
        }
        if (_skeleton.save) {
            await save_files(_skeleton);
        }
        if (!_skeleton.no_puppeteer && env.puppeteer.allow && !global_session) {
            await terminate_puppeteer_session(_skeleton.puppeteer_session);
            remove_puppeteer_temp_file(_skeleton.template.temporary_path || "");
        }
        log("finish time", Date.now() - start_time);

        if (new_page) {
            _skeleton.puppeteer_session?.page?.close?.();
        }
        (_skeleton as any).puppeteer_session = undefined;
        return _skeleton;
    } catch (error) {
        log.error("Document Render Error:", error);
    }
    return undefined;
}

export default render_document_from_skeleton;

export {
    create_puppeteer_session,
    global_session,
    global_temporary_html_file,
    load_images,
    paper_map,
    process,
    render,
    render_document_from_skeleton,
    render_skeleton,
    replaceAsync,
    save_files,
    wrap
};

interface Paper {
    size: { width: number; height: number };
}
type PaperType = "A4" | "A3" | "A1" | "Letter";
type PapersSizes = {
    [key in PaperType]?: Paper;
};

type Html = string;
type FilePath = string;

type DirectoryPath = string;
type TemplateName = string;

type Section = Html;

type SectionName = string;

type Sections = {
    [key: string]: Section;
};

interface PuppeteerSession {
    temporary_path?: FilePath;
    browser?: import("puppeteer").Browser;
    page?: import("puppeteer").Page;
    cm_per_px?: number;
    real_cm_per_px?: number;
}

interface Margins {
    left?: string;
    right?: string;
    top?: string;
    bottom?: string;
}

interface Header {
    section?: SectionName;
    height_in_px?: number;
    height_in_cm?: number;
    content?: Content;
    type?: SectionName;
    style?: {
        [key: string]: {
            [key: string]: string;
        };
    };
}
interface Footer {
    section?: SectionName;
    height_in_px?: number;
    height_in_cm?: number;
    content?: Content;
    type?: SectionName;
    style?: {
        [key: string]: {
            [key: string]: string;
        };
    };
}
interface RenderedHeader {
    section?: SectionName;
    html?: Html;
    height_in_px?: number;
    height_in_cm?: number;
    content?: Content;
    type?: SectionName;
    style?: {
        [key: string]: {
            [key: string]: string;
        };
    };
}
interface RenderedFooter {
    section?: SectionName;
    html?: Html;
    height_in_px?: number;
    height_in_cm?: number;
    content?: Content;
    type?: SectionName;
    style?: {
        [key: string]: {
            [key: string]: string;
        };
    };
}

interface RenderedSkeletonTemplate {
    name?: TemplateName | DirectoryPath;
    html?: Html;
    last_page_footer?: SectionDescriptor;
    final_template?: Html;
    wrapped_final_html?: Html;
    template_directory?: DirectoryPath;
    index_path?: FilePath;
    temporary_path?: FilePath;
    margin?: Margins;
    header?: RenderedHeader;
    footer?: RenderedFooter;
    cm_per_px?: number;
    pdf_buffer?: Buffer;
}
interface SkeletonTemplate {
    last_page_footer?: {
        section?: string;
        type?: string;
    };
    name?: TemplateName | DirectoryPath;
    margin?: Margins;
    header?: Header;
    footer?: Footer;
    cm_per_px?: number;
}

export interface SectionDescriptor {
    content?: Content;
    type?: SectionName;
    style?: {
        [key: string]: {
            [key: string]: string;
        };
    };
}

type Content = Array<SectionDescriptor>;

type Css = string;

interface SkeletonStyle {
    css: Css;
    paper: PaperType;
    load_css: boolean;
    wrap: boolean;
    load_images: boolean;
    load_images_as_urls: boolean;
}

interface SaveSkeletonOptions {
    dir: DirectoryPath;
    data: boolean;
    skeleton: boolean;
    rendered_template: boolean;
    pdf: boolean;
}

interface RenderedDocumentSkeleton {
    template: RenderedSkeletonTemplate;
    puppeteer_session: PuppeteerSession;
    sections: Sections;
    data: any;
    files: Array<FilePath>;
    content: Content;
    style: SkeletonStyle;
    no_puppeteer: boolean;
    dont_respond: boolean;
    save: SaveSkeletonOptions;
}

interface DocumentSkeleton {
    template: SkeletonTemplate;
    data: any;
    content: Content;
    style: SkeletonStyle;
    no_puppeteer: boolean;
    dont_respond: boolean;
    save: SaveSkeletonOptions;
}
