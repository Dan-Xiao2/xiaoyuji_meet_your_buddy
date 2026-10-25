import { initializeDurableArchive } from "./services/indexedArchive.js";
import { validateStoredArchive } from "./services/archiveIntegrity.js";
import { mountArchiveRecovery } from "./ui/archiveRecovery.js";

let recovery = {};
let readable = false;
try {
  recovery = await initializeDurableArchive(window.localStorage);
  validateStoredArchive(window.localStorage);
  if (recovery.needsRecovery) throw new Error(recovery.error);
  readable = true;
} catch {
  mountArchiveRecovery(recovery.snapshot);
}
if (readable) await import("./app.js");
document.querySelector(".app-shell").inert = false;
document.querySelector(".app-shell").removeAttribute("aria-busy");
if (!readable) document.querySelector("#archiveRecoveryTitle").focus();
