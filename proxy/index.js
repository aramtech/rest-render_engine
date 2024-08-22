// Import the worker_threads module
import { Worker } from "worker_threads";
import root_paths from "../../../dynamic_configuration/root_paths.ts";

console.log("about to start the worker");
const renderWorker = new Worker(`${root_paths.src_path}/utils/render_engine/proxy/worker.js`);
console.log("started the worker");

/**
 * @param {import('../index.js').DocumentSkeleton} skeleton
 * @returns {Promise<import('../index.js').RenderedDocumentSkeleton>}
 */
function render(skeleton) {
    return new Promise((resolve, reject) => {
        renderWorker.postMessage(skeleton);
        renderWorker.on("message", (result) => {
            if (result?.error) {
                reject(result.error);
            }
            resolve(result);
        });
    });
}
export default render;
