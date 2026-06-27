import { n as onDestroy } from "../../../chunks/index-server.js";
import { v as attr, y as escape_html } from "../../../chunks/server.js";
import "../../../chunks/api.js";
import { format } from "date-fns";
//#region src/routes/stats/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let autoRefresh = true;
		onDestroy(() => {});
		$$renderer.push(`<div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4"><div class="max-w-7xl mx-auto flex items-center justify-between"><div class="flex items-center gap-4"><a href="/" class="btn-ghost text-sm py-1.5 px-3">← Dashboard</a> <div><h1 class="text-white font-bold text-lg leading-tight">Chain Statistics</h1> <p class="text-blue-300 text-xs">Real-time blockchain monitoring</p></div></div> <div class="flex items-center gap-3"><button class="btn-ghost text-sm py-1.5 px-3">🔄 Refresh</button> <label class="flex items-center gap-2 cursor-pointer text-sm text-blue-200"><input type="checkbox"${attr("checked", autoRefresh, true)} class="w-4 h-4 accent-sky-400"/> Auto (10s)</label> <span class="text-xs text-blue-400 hidden sm:block">${escape_html(format(/* @__PURE__ */ new Date(), "HH:mm:ss"))}</span></div></div></div> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="min-h-[60vh] flex items-center justify-center"><div class="text-center"><div class="w-10 h-10 border-4 border-blue-200 border-t-blue-700 rounded-full animate-spin mx-auto mb-4"></div> <p class="text-slate-500 text-sm">Loading statistics…</p></div></div>`);
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
export { _page as default };
