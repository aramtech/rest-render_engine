/**
 * @typedef {Object} Paper
 * @property {{width:number, height: number}} size
 */
/**
 * @typedef {"A4"|"A3"|"A1"|"Letter"} PaperType
 */
/**
 * @typedef {Object.<PaperType, Paper>} PapersSizes
 */

/**
 * @typedef {string} Html
 */
/**
 * @typedef {string} FilePath
 */

/**
 * @typedef {string} DirectoryPath
 */
/**
 * @typedef {string} TemplateName
 */

/**
 * @typedef {Html} Section
 */

/**
 * @typedef {String} SectionName
 */

/**
 * @typedef {Object.<string, Section>} Sections
 */

/**
 * @typedef {Object} PuppeteerSession
 * @property {FilePath} temporary_path
 * @property {Browser} browser
 * @property {Page} page
 * @property {number} cm_per_px
 */

/**
 * @typedef {Object} Margins
 * @property {string} left
 * @property {string} right
 * @property {string} top
 * @property {string} bottom
 */

/**
 * @typedef {Object} Header
 * @property {SectionName} section
 * @property {Number} height_in_px
 * @property {Number} height_in_cm
 * @property {Content} content
 * @property {SectionName} type
 * @property {Object.<string, Object.<string, string>>} style
 */
/**
 * @typedef {Object} Footer
 * @property {SectionName} section
 * @property {Number} height_in_px
 * @property {Number} height_in_cm
 * @property {Content} content
 * @property {SectionName} type
 * @property {Object.<string, Object.<string, string>>} style
 */
/**
 * @typedef {Object} RenderedHeader
 * @property {SectionName} section
 * @property {Html} html
 * @property {Number} height_in_px
 * @property {Number} height_in_cm
 * @property {Content} content
 * @property {SectionName} type
 * @property {Object.<string, Object.<string, string>>} style
 */
/**
 * @typedef {Object} RenderedFooter
 * @property {SectionName} section
 * @property {Html} html
 * @property {Number} height_in_px
 * @property {Number} height_in_cm
 * @property {Content} content
 * @property {SectionName} type
 * @property {Object.<string, Object.<string, string>>} style
 *
 */

/**
 * @typedef {Object} RenderedSkeletonTemplate
 * @property {TemplateName|DirectoryPath} name
 * @property {Html} html template html
 * @property {Html} final_template rendered html not wrapped
 * @property {Html} wrapped_final_html wrapped rendered html
 * @property {DirectoryPath} template_directory template html
 * @property {FilePath} index_path template html
 * @property {FilePath} temporary_path
 * @property {Margins} margin
 * @property {RenderedHeader} header
 * @property {RenderedFooter} footer
 * @property {Number} cm_per_px
 * @property {Buffer} pdf_buffer
 */
/**
 * @typedef {Object} SkeletonTemplate
 * @property {TemplateName|DirectoryPath} name
 * @property {Margins} margin
 * @property {Header} header
 * @property {Footer} footer
 * @property {Number} cm_per_px
 */

/**
 * @typedef {Object} SectionDescriptor
 * @property {Content} content
 * @property {SectionName} type
 * @property {Object.<string, Object.<string, string>>} style
 *
 *
 *
 */

/**
 * @typedef {Array<SectionDescriptor>} Content
 */

/**
 * @typedef {string} Css
 */

/**
 * @typedef {Object} SkeletonStyle
 * @property {Css} css
 * @property {PaperType} paper
 * @property {Boolean} load_css
 * @property {Boolean} wrap
 * @property {Boolean} load_images
 * @property {Boolean} load_images_as_urls
 */

/**
 * @typedef {Object} SaveSkeletonOptions
 * @property {DirectoryPath} dir
 * @property {Boolean} data
 * @property {Boolean} skeleton
 * @property {Boolean} rendered_template
 * @property {Boolean} pdf
 *
 */

/**
 * @typedef {Object} RenderedDocumentSkeleton
 * @property {RenderedSkeletonTemplate} template
 * @property {PuppeteerSession} puppeteer_session
 * @property {Sections} sections
 * @property {*} data
 * @property {Content} content
 * @property {SkeletonStyle} style
 * @property {Boolean} no_puppeteer
 * @property {SaveSkeletonOptions} save
 *
 */

/**
 * @typedef {Object} DocumentSkeleton
 * @property {SkeletonTemplate} template
 * @property {*} data
 * @property {Content} content
 * @property {SkeletonStyle} style
 * @property {Boolean} no_puppeteer
 * @property {SaveSkeletonOptions} save
 */
