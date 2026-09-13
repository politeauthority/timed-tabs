/**
 * Asking for an optional permission from a click, the one place the browser sees a user gesture.
 */
import { api } from "../shared/browser.js";

/** True once the optional permissions a setting needs are granted. */
export async function requestPermission(requires) {
  try {
    return await api.permissions.request(requires);
  } catch {
    return false;
  }
}
