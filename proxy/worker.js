import { parentPort } from "worker_threads";
console.log("about to import the engine");
import render from "$/server/utils/render_engine/index.js";

parentPort.on("message", async (skeleton) => {
    try {
        const doc = await render(skeleton);
        if (skeleton?.dont_respond) {
            parentPort.postMessage("Done");
        } else {
            parentPort.postMessage(doc);
        }
    } catch (error) {
        console.log(error);
        parentPort.postMessage({ error });
    }
});
console.log("started render engine listener");
