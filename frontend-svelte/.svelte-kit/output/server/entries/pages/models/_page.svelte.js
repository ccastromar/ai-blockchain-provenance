import "../../../chunks/index-server.js";
import { a as stringify, r as ensure_array_like, t as attr_class, y as escape_html } from "../../../chunks/server.js";
import "../../../chunks/api.js";
//#region src/routes/models/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let models = [];
		let selectedModelId = "";
		const STATUS_STYLES = {
			active: "bg-emerald-100 text-emerald-700",
			deprecated: "bg-amber-100 text-amber-700",
			archived: "bg-slate-100 text-slate-500"
		};
		$$renderer.push(`<div class="min-h-screen bg-slate-50"><div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4"><div class="max-w-6xl mx-auto flex items-center justify-between"><div class="flex items-center gap-4"><a href="/" class="btn-ghost text-sm py-1.5 px-3">← Dashboard</a> <h1 class="text-white font-semibold text-lg">AI Models</h1> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div></div></div> <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8"><div class="grid grid-cols-1 md:grid-cols-5 gap-6"><div class="md:col-span-2 flex flex-col gap-3"><h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Registered Models</h2> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="card overflow-hidden">`);
		if (models.length === 0) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="py-10 text-center text-slate-400 text-sm">No models registered yet.</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--[-->`);
			const each_array = ensure_array_like(models);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let m = each_array[$$index];
				$$renderer.push(`<button${attr_class(`w-full text-left px-5 py-3.5 border-b border-slate-100 last:border-0 hover:bg-blue-50 transition-colors ${selectedModelId === m.modelId ? "bg-blue-50 border-l-4 border-l-blue-700 pl-4" : ""}`)}><div class="flex items-center justify-between gap-2"><div class="font-medium text-slate-800 text-sm truncate">${escape_html(m.modelId)}</div> `);
				if (m.status && m.status !== "active") {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<span${attr_class(`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${stringify(STATUS_STYLES[m.status] ?? "")}`)}>${escape_html(m.status)}</span>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div> <div class="text-xs text-slate-500 mt-0.5">${escape_html(m.name || "No name")} · v${escape_html(m.version)}</div></button>`);
			}
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div> <div class="md:col-span-3">`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<div class="card p-12 text-center text-slate-400"><div class="text-3xl mb-3">🔍</div> <div class="text-sm">Select a model from the list to view details.</div></div>`);
		$$renderer.push(`<!--]--></div></div></div></div>`);
	});
}
//#endregion
export { _page as default };
