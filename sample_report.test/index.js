const path = (await import("path")).default;
const url = (await import("url")).default;
const fs = (await import("fs")).default;

const env = (await import("$/server/env.js")).default;

const app_path = env.app_path;

const daily_report_data_generator = (await import("./generate_daily_report_data.js")).default;
const render_engine = (await import("$/server/utils/render_engine/index.js")).default;

const email = (await import("$/server/utils/render_engine/utils/email/index.js")).default;

const genere_daily_report = async () => {
    const data = await daily_report_data_generator();
    const task_type_map = function (task) {
        if (task.type == 1) {
            return "Yes";
        } else {
            return `No, created at ${new Date(task.created_at).toString().slice(16, 24)}`;
        }
    };
    const stringify_task_details = function (task) {
        function intro() {
            let intro = `
      `;
            if (task?.task_type == "public_sector") {
                intro += `
          Establishment Name: ${task.public_sector.name} -- 
          Doctor Name: ${task.public_sector.doctor_name} --
          Alternative Doctor Name: ${task.public_sector.alternative_doctor_name} --
          Task Classification: ${task.public_sector.classification} --
          Speciality: ${task.public_sector.speciality} --
          Comments: ${task.public_sector.comment}
        `;
            } else if (task?.task_type == "pharmacy") {
                intro += `
          Pharmacy Name: ${task.pharmacy.name} -- 
          Area: ${task.pharmacy.area} --
          Person Name: ${task.pharmacy.person} --
          Comments: ${task.pharmacy.comment}
        `;
            } else if (task?.task_type == "private_sector") {
                intro += `
          Establishment Name: ${task.private_sector.name} -- 
          Doctor Name: ${task.private_sector.doctor_name} --
          Alternative Doctor Name: ${task.private_sector.alternative_doctor_name} --
          Comments: ${task.private_sector.comment}
        `;
            }
            return intro;
        }
        function started() {
            if (task.status == 2 || task.status == 3) {
                let string = ``;
                const start_details = task.start_json;
                const Start_time = new Date(start_details.timestamp);
                string += `started at: ${Start_time.toLocaleString()}`;
                return string;
            } else {
                return ``;
            }
        }
        function cancelled() {
            if (task.status == 4) {
                const finish_details = task.finish_json;
                const finish_time = new Date(finish_details.timestamp);
                let string = `
        cancelled at: ${finish_time.toLocaleString()}
        cancelled because: ${finish_details.why}`;
                return string;
            } else {
                return ``;
            }
        }
        function finished() {
            if (task.status == 3) {
                let string = ``;
                const finish_details = task.finish_json;
                const finish_time = new Date(finish_details.timestamp);
                string += `
          finished at: ${finish_time.toLocaleString()}
          ${finish_details[task.task_type].alternative_doctor_name ? `Alternative Doctor: ${finish_details[task.task_type].alternative_doctor_name}` : ""}
          
          Finish Comments: ${finish_details[task.task_type].comment}
        `;
                return string;
            } else {
                return ``;
            }
        }
        function text() {
            return `
        ${intro()}
        ${started()}
        ${cancelled()}
        ${finished()}
      `;
        }
        return text();
    };
    const status_map = function (task) {
        const map = {
            1: "Pending",
            2: "Started",
            3: "Finished",
            4: "Cancelled",
            5: "Unfinished",
        };
        return map[task.status];
    };

    const report_skeleton = {
        // (*) means this will be placed on output,
        template: {
            // absolute path, also could be template dir or index file path which
            // will be searched for in /app/path/server/templates/.
            name: "main",

            header: {
                section: "header",
                style: {
                    main: {
                        margin: "0px 0.4cm",
                        width: "100%",
                        font_size: "8px",
                        z_index: "10000",
                    },
                    container: {
                        display: "flex",
                        justify_content: "space-between",
                        flex_wrap: "nowrap",
                        width: "100%",
                        align_content: "center",
                    },
                    left: {
                        display: "flex",
                        justify_content: "center",
                        align_content: "center",
                    },
                    center: {},
                    right: {},
                    hr: {
                        height: "1px",
                        border: "solid 0px transparent",
                        box_shadow: "none",
                        background_color: "rgba(,0,0,0)",
                    },
                },
                left: [
                    {
                        type: "span",
                        text: "Sanpharma",
                        style: {
                            display: "block",
                            color: "#006EE9",
                            font_weight: "bold",
                        },
                    },
                    {
                        type: "img",
                        src: path.join(app_path, "server/assets/images", env.client.app_logo.png),
                        style: {
                            margin_left: "4px",
                            margin_top: "-1px",
                            display: "block",
                            width: "15px",
                            text_align: null, // place it after the pre text
                        },
                    },
                ],
                center: [
                    {
                        type: "span",
                        text: `Daily Report of [${data.yesterday.toString().slice(0, 10)}]`,
                        style: {},
                    },
                ],
                right: [
                    {
                        type: "span",
                        classes: ["pageNumber"],
                        style: {},
                    },
                    {
                        type: "span",
                        classes: [],
                        text: "/",
                        style: {},
                    },
                    {
                        type: "span",
                        text: null,
                        classes: ["totalPages"],
                        style: {},
                    },
                ],
                hr_bottom: true,
                hr_top: false,
            },
            footer: {
                section: "header",
                style: {
                    main: {
                        margin: "0px 0.4cm",
                        width: "100%",
                        font_size: "8px",
                        z_index: "10000",
                        background_color: "red",
                    },
                    container: {
                        display: "flex",
                        justify_content: "space-between",
                        flex_wrap: "nowrap",
                        width: "100%",
                        align_content: "center",
                    },
                    left: {
                        display: "flex",
                        justify_content: "center",
                        align_content: "center",
                    },
                    center: {},
                    right: {},
                    hr: {
                        height: "1px",
                    },
                },
                left: [
                    {
                        type: "span",
                        text: "By AramTech",
                        style: {
                            display: "block",
                            color: "#006EE9",
                            font_weight: "bold",
                        },
                    },
                    {
                        type: "img",
                        src: path.join(app_path, "server/assets/images", env.corp.logo.png),
                        style: {
                            margin_left: "4px",
                            margin_top: "-1px",
                            display: "block",
                            width: "15px",
                            text_align: null, // place it after the pre text
                        },
                    },
                ],
                center: [],
                right: [],
                hr_bottom: false,
                hr_top: true,
            },
            // * html, the raw html of the template
            // * directory, absolute directory of the template
            // * index_path, absolute html index path of the template
            // * temporary_path, absolute path for the temporary file name (used for puppeteer session)
            // * wrapped final html, will be generated if the wrap flag is set in the style of the skeleton
            // * final_template, the rendered content of the template
            // * pdf_buffer, the pdf buffer of the document generated
        },

        // the skeleton source data,
        data: data,

        // save generated elements
        save: {
            // directory under public which files will be placed
            dir: `reports/daily/_${data.yesterday.toLocaleString().replaceAll(/[\,\s\:\/]/gi, "_")}`,
            skeleton: true,
            data: true,
            rendered_template: true,
            pdf: true,
        },

        // style controller for the document
        style: {
            // you can place css in the skeleton
            css: `
                body, html {
                    position:relative;
                    padding:0px;
                    margin:0px;
                }

                @media print {
                    body, html {
                        padding:0px;
                        margin:0px;
                    }
                }
            `,

            // wrap the final rendered template with the raw html of template
            // after emptying body
            wrap: true,
            load_images_as_urls: false,
            // load images to data urls
            load_images: false,
            // load style from source css files to style tags
            load_css: false,

            // paper format
            paper: "A4",

            // margin can be number or object containing top bottom right left
            margin: 30,
        },

        content: [
            // this is a section
            // a section object is accesable at the template with $
            {
                type: "cover_page", // --
                text: `Daily Report of [${data.yesterday.toString().slice(0, 10)}]`,
                style: {
                    title: {
                        color: "#000000",
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        opacity: 1,
                        text_align: "center",
                        font_weight: "normal",
                        font_size: null, // uses normal
                    },
                },
            },
            {
                type: "page_break",
            },
            ...data.users.map((user) => {
                return [
                    // this is a section
                    {
                        type: "card", // reserved key word, section key
                        title: user.name,
                        style: {
                            title: null || {
                                font_weight: "normal",
                                color: "#000000",
                                size: null, // uses default title size
                                opacity: 1,
                                text_align: "start",
                            },
                            card: {
                                height: `calc(100%)`,
                                background_color: "transparent",
                                border: "black 1px solid",
                                border_radius: "0.3cm",
                                padding: "0.3cm",
                            },
                            card_content: {},
                        },
                        // sub section selected with %%section<$.content>%%
                        content: [
                            {
                                type: "keyvalue",
                                title: "Employee Info",
                                style: {
                                    container: {
                                        border: "black 1px solid",
                                        border_radius: "0.3cm",
                                        padding: "0.2cm",
                                    },
                                    title: {
                                        font_weight: "normal",
                                        color: "#000000",
                                        font_size: "14px", // uses default title size
                                        opacity: 1,
                                        text_align: "start",
                                        background_color: "transparent",
                                    },
                                    pair: {},
                                    key: null || {
                                        font_weight: "bold",
                                        color: "#000000",
                                        size: null, // uses default normal size
                                        opacity: 1,
                                        text_align: "start",
                                        background_color: "transparent",
                                    },
                                    value: null || {
                                        font_weight: "normal",
                                        color: "#000000",
                                        size: null, // uses default normal size
                                        opacity: 1,
                                        text_align: "start",
                                        background_color: "transparent",
                                        margin_right: "0.2cm",
                                    },
                                    no_data: {},
                                },
                                data: {
                                    username: user.user_name,
                                    name: user.name,
                                    user_id: user.user_id,
                                    email: user.email,
                                    phone: user.phene_number,
                                },
                            },
                            {
                                type: "hr",
                                style: null || {
                                    color: "#eeeeee",
                                    opacity: 1,
                                    text_align: "start",
                                    thickness: "1px",
                                    width: "100%", // percentage of page width 1 -> 100
                                },
                            },
                            user.bundle
                                ? {
                                      type: "table",
                                      title: "Tasks",
                                      style: {
                                          container: null,
                                          table: null || {
                                              width: "100%",
                                              border: "solid black 1px",
                                          },
                                          td: null || {
                                              border: "solid black 1px",
                                              color: "#000000",
                                              opacity: 1,
                                              font_size: "12px",
                                              background_color: "#eeeeee",
                                              text_align: "start",
                                          },
                                          th: null || {
                                              border: "solid black 1px",
                                              font_weight: "bold",
                                              color: "#000000",
                                              font_size: "12px",
                                              opacity: 1,
                                              background_color: "#eeeeee",
                                              text_align: "start",
                                          },
                                          tr: null,
                                          thead: null,
                                          title: null || {
                                              font_weight: "bold",
                                              color: "#000000",
                                              opacity: 1,
                                              text_align: "center",
                                          },
                                      },
                                      headers: [
                                          {
                                              text: "Priority",
                                              key: "primary",
                                          },
                                          {
                                              text: "Task Details",
                                              key: "task_details",
                                          },
                                          {
                                              text: "Status",
                                              key: "text_status",
                                          },
                                      ],
                                      data: [
                                          ...user.bundle.tasks.map((task) => {
                                              return {
                                                  ...task,
                                                  primary: task_type_map(task),
                                                  task_details: stringify_task_details(task),
                                                  text_status: status_map(task),
                                              };
                                          }),
                                      ],
                                  }
                                : [
                                      {
                                          type: "newline",
                                          style: {
                                              count: 2,
                                          },
                                      },
                                      {
                                          type: "title",
                                          data: {
                                              text: "Has No Bunle",
                                          },
                                          style: {
                                              font_weight: "normal",
                                              color: "#000000",
                                              opacity: 1,
                                              size: "12px",
                                              text_align: "center",
                                              align: "center",
                                              background_color: "#eeeeee",
                                          },
                                      },
                                      {
                                          type: "newline",
                                          style: {
                                              count: 2,
                                          },
                                      },
                                  ],
                            {
                                type: "hr",
                                style: null || {
                                    color: "#eeeeee",
                                    opacity: 1,
                                    text_align: "start",
                                    thickness: 1,
                                    width: 100, // percentage of page width 1 -> 100
                                },
                            },
                        ],
                    },
                    {
                        type: "page_break",
                    },
                ];
            }),
        ],
    };

    const rendered_report_skeleton = await render_engine.render_document_from_skeleton(report_skeleton);
    rendered_report_skeleton;
    const email_skeleton = {
        // (*) means this will be placed on output,
        template: {
            // absolute path, also could be template dir or index file path which
            // will be searched for in /app/path/server/templates/.
            name: "main",
            // * html, the raw html of the template
            // * directory, absolute directory of the template
            // * index_path, absolute html index path of the template
            // * temporary_path, absolute path for the temporary file name (used for puppeteer session)
            // * wrapped final html, will be generated if the wrap flag is set in the style of the skeleton
            // * final_template, the rendered content of the template
            // * pdf_buffer, the pdf buffer of the document generated
        },

        // the skeleton source data,
        data: null,

        // save generated elements
        save: {
            // directory under public which files will be placed
            dir: `emails/daily_report_emails/_${data.yesterday.toLocaleString().replaceAll(/[\,\s\:\/]/gi, "_")}`,
            skeleton: true,
            rendered_template: true,
            data: false,
            pdf: false,
        },

        // style controller for the document
        style: {
            // you can place css in the skeleton
            css: `
        html {
          width:100%;
          height:100%;
          background-color:#eeeeee;
          padding:0px;
          margin:0px;
        }
        body {
          background-color:#ffffff;
          width:21cm;
          height:29cm;
          margin:0px;
          padding:0px;
          margin-right:auto;
          margin-left:auto;
        }


      `,

            // wrap the final rendered template with the raw html of template
            // after emptying body
            wrap: true,

            // load images to data urls
            load_images: true,
            load_images_as_urls: true,
            // load style from source css files to style tags
            load_css: false,

            // paper format
            // paper: "A4", // (no paper format for email)

            // margin can be numer or object containing top bottom right left
            // margin: 30, // no paper margins required
        },

        content: [
            {
                type: "card", // reserved key word, section key
                // title: "Daily Report",
                style: {
                    title: null || {
                        font_weight: "normal",
                        width: "100%",
                        color: "#006EE9",
                        font_size: "1cm;", // uses default title size
                        opacity: 1,
                        text_align: "center",
                        margin_bottom: "0cm",
                        padding: "0cm",
                        padding_top: "0.5cm",
                        padding_bottom: "0.5cm",
                    },
                    title_h3: {
                        margin: "0cm",
                        padding: "0cm",
                    },
                    card: {
                        height: `calc(97.3%)`,
                        background_color: "#ffffff",
                        border: "black 1px solid",
                        border_radius: "0.3cm",
                        padding: "0.3cm",
                    },
                    card_content: {
                        position: "relative",
                        height: "100%",
                        margin: "0cm",
                        padding: "0cm",
                    },
                },
                content: [
                    {
                        type: "header",
                        style: {
                            main: {
                                margin: "0px 0px",
                                width: "100%",
                                font_size: "18px",
                            },
                            container: {
                                display: "flex",
                                justify_content: "space-between",
                                // flex_wrap:"nowrap",
                                width: "100%",
                                align_content: "center",
                            },
                            left: {
                                display: "flex",
                                justify_content: "center",
                                align_content: "center",
                            },
                            center: {},
                            right: {},
                            hr: {},
                        },
                        left: [
                            {
                                type: "span",
                                text: "Sanpharma",
                                style: {
                                    display: "block",
                                    color: "#006EE9",
                                    font_weight: "bold",
                                },
                            },
                            {
                                type: "img",
                                src: path.join(app_path, "server/assets/images", env.client.app_logo.png),
                                style: {
                                    width: "auto",
                                    height: "auto",
                                    margin_left: "4px",
                                    display: "block",
                                    max_width: "30px",
                                    max_height: "30px",
                                    text_align: null, // place it after the pre text
                                },
                            },
                        ],
                        center: [
                            {
                                type: "span",
                                text: `Daily Report of [${data.yesterday.toString().slice(0, 10)}]`,
                                style: {},
                            },
                        ],
                        right: [],
                        hr_bottom: true,
                        hr_top: false,
                    },
                    {
                        type: "p",
                        text: "Daily Report",
                        style: {
                            font_weight: "normal",
                            width: "100%",
                            color: "#006EE9",
                            font_size: "3em;", // uses default title size
                            opacity: 1,
                            text_align: "center",
                            margin_bottom: "0cm",
                            padding: "0cm",
                            padding_top: "0.5cm",
                            padding_bottom: "0.5cm",
                            font_weight: "bold",
                        },
                    },
                    {
                        type: "hr",
                        style: {
                            width: "100%",
                            padding: "0px",
                            margin: "0px",
                            margin_bottom: "0.4cm",
                        },
                    },
                    {
                        type: "card",
                        style: {
                            card: {
                                width: "90%",
                                margin: "0cm",
                                margin_right: "auto",
                                margin_left: "auto",
                                background_color: "#ffffff",
                                padding: "0.3cm",
                            },
                            card_content: {
                                margin: "0cm",
                                padding: "0cm",
                            },
                        },
                        content: [
                            {
                                type: "p",
                                text: "Dears.",
                                style: {
                                    font_size: "24px",
                                    font_weight: "bold",
                                },
                            },
                            {
                                type: "p",
                                text: `Please find here the daily report for ${data.yesterday.toString().slice(0, 10)}
                attached to this email.
                `,
                                style: {
                                    font_size: "22px",
                                },
                            },
                            {
                                type: "newline",
                                style: {
                                    count: 2,
                                },
                            },
                            {
                                type: "p",
                                text: `B.R.`,
                                style: {
                                    font_size: "22px",
                                    font_weight: "bold",
                                },
                            },
                        ],
                    },
                    {
                        type: "header",
                        style: {
                            main: {
                                margin: "0px 0px",
                                width: "100%",
                                position: "absolute",
                                bottom: "0px",
                                font_size: "18px",
                            },
                            container: {
                                display: "flex",
                                justify_content: "space-between",
                                flex_wrap: "nowrap",
                                width: "100%",
                                align_content: "center",
                            },
                            left: {
                                display: "flex",
                                justify_content: "center",
                                align_content: "center",
                            },
                            center: {},
                            right: {},
                            hr: {
                                height: "1px",
                            },
                        },
                        left: [
                            {
                                type: "span",
                                text: "By AramTech",
                                style: {
                                    display: "block",
                                    color: "#006EE9",
                                    font_weight: "bold",
                                },
                            },
                            {
                                type: "img",
                                src: path.join(app_path, "server/assets/images", env.corp.logo.png),
                                style: {
                                    margin_left: "4px",
                                    display: "block",
                                    width: "30px",
                                    text_align: null, // place it after the pre text
                                },
                            },
                        ],
                        center: [],
                        right: [],
                        hr_bottom: false,
                        hr_top: true,
                    },
                ],
            },
        ],
    };
    const rendered_email_skeleton = await render_engine.render_skeleton(email_skeleton);

    await email.send({
        subject: `Daily Report of [${data.yesterday.toString().slice(0, 10)}]`,
        to: ["salem@aramtech.ly", "s.elmotamed96@gmail.com", "s.elmotamed96@gmail.com", "moyaser@aramtech.ly"],
        html: rendered_email_skeleton.template.wrapped_final_html,
        attachments: [
            {
                filename: `Daily Report of ${data.yesterday.toString().slice(0, 10)}.pdf`,
                content: rendered_report_skeleton.template.pdf_buffer,
            },
        ],
    });
};

await genere_daily_report();
