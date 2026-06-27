import "../../chunks/index-server.js";
import { r as ensure_array_like, t as attr_class, v as attr, y as escape_html } from "../../chunks/server.js";
import { r as getChainStats } from "../../chunks/api.js";
import "date-fns";
//#region src/lib/components/ModelRegistration.svelte
function ModelRegistration($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { onSuccess } = $$props;
		let existingModels = [];
		let selectedPreset = "";
		let modelId = "";
		let modelName = "";
		let version = "0.1.0";
		function applyPreset(e) {
			const id = e.target.value;
			selectedPreset = id;
			if (!id) return;
			const m = existingModels.find((m) => m.modelId === id);
			if (!m) return;
			modelId = m.modelId;
			modelName = m.name ?? "";
			version = m.version ?? DEFAULTS.version;
		}
		let params = "{\"param1\": \"value1\", \"param2\": 10}";
		let metrics = "{\"accuracy\": 0.9, \"f1_score\": 0.85}";
		let metadata = "{\"dataset\": \"Sample Dataset\", \"framework\": \"PyTorch\"}";
		let mlflow = "{\"modelHash\": \"0000000000000000000000000000000000000000000000000000000000000000\", \"gitCommit\": \"abcdef1234567890abcdef1234567890abcdef12\"}";
		let loading = false;
		const DEFAULTS = {
			version: "0.1.0",
			params: "{\"param1\": \"value1\", \"param2\": 10}",
			metrics: "{\"accuracy\": 0.9, \"f1_score\": 0.85}",
			metadata: "{\"dataset\": \"Sample Dataset\", \"framework\": \"PyTorch\"}",
			mlflow: "{\"modelHash\": \"0000000000000000000000000000000000000000000000000000000000000000\", \"gitCommit\": \"abcdef1234567890abcdef1234567890abcdef12\"}"
		};
		$$renderer.push(`<div class="max-w-2xl space-y-6"><div><h2 class="text-xl font-semibold text-slate-800">Register AI Model</h2> <p class="text-sm text-slate-500 mt-1">Add a new model to the blockchain provenance chain</p></div> `);
		if (existingModels.length) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="bg-blue-50 border border-blue-200 rounded-lg p-4"><label class="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-2 block">Quick-fill from existing model</label> `);
			$$renderer.select({
				onchange: applyPreset,
				value: selectedPreset,
				class: "field-input text-sm"
			}, ($$renderer) => {
				$$renderer.option({ value: "" }, ($$renderer) => {
					$$renderer.push(`— Select a model to pre-fill —`);
				});
				$$renderer.push(`<!--[-->`);
				const each_array = ensure_array_like(existingModels);
				for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
					let m = each_array[$$index];
					$$renderer.option({ value: m.modelId }, ($$renderer) => {
						$$renderer.push(`${escape_html(m.modelId)} · ${escape_html(m.name ?? "No name")} · v${escape_html(m.version)}`);
					});
				}
				$$renderer.push(`<!--]-->`);
			});
			$$renderer.push(` <p class="text-xs text-blue-500 mt-1.5">Fills Model ID, Name and Version. Adjust the rest before submitting.</p></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <form class="space-y-4"><div class="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label class="field-label" for="reg-modelId">Model ID *</label> <input id="reg-modelId" type="text" required=""${attr("value", modelId)} class="field-input" placeholder="chest-xray-classifier-v1"/></div> <div><label class="field-label" for="reg-version">Version *</label> <input id="reg-version" type="text" required=""${attr("value", version)} class="field-input" placeholder="1.0.0"/></div></div> <div><label class="field-label" for="reg-modelName">Model Name *</label> <input id="reg-modelName" type="text" required=""${attr("value", modelName)} class="field-input" placeholder="Chest X-ray Classifier v1"/></div> <div class="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label class="field-label" for="reg-params">Parameters (JSON)</label> <textarea id="reg-params"${attr("rows", 4)} class="field-input font-mono text-xs" placeholder="learning_rate, epochs...">`);
		const $$body = escape_html(params);
		if ($$body) $$renderer.push(`${$$body}`);
		$$renderer.push(`</textarea></div> <div><label class="field-label" for="reg-metrics">Metrics (JSON)</label> <textarea id="reg-metrics"${attr("rows", 4)} class="field-input font-mono text-xs" placeholder="accuracy, f1_score...">`);
		const $$body_1 = escape_html(metrics);
		if ($$body_1) $$renderer.push(`${$$body_1}`);
		$$renderer.push(`</textarea></div></div> <div><label class="field-label" for="reg-metadata">Metadata (JSON)</label> <textarea id="reg-metadata"${attr("rows", 3)} class="field-input font-mono text-xs" placeholder="dataset, framework, author...">`);
		const $$body_2 = escape_html(metadata);
		if ($$body_2) $$renderer.push(`${$$body_2}`);
		$$renderer.push(`</textarea></div> <div><label class="field-label" for="reg-mlflow">MLFlow (JSON)</label> <textarea id="reg-mlflow"${attr("rows", 3)} class="field-input font-mono text-xs" placeholder="modelHash, gitCommit...">`);
		const $$body_3 = escape_html(mlflow);
		if ($$body_3) $$renderer.push(`${$$body_3}`);
		$$renderer.push(`</textarea></div> <button type="submit"${attr("disabled", loading, true)} class="btn-primary w-full">${escape_html("Register Model")}</button></form> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
//#region src/lib/components/InferenceLogger.svelte
function InferenceLogger($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { initialModelId = "", onSuccess } = $$props;
		let modelId = initialModelId;
		let input = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
		let outputHash = "d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2";
		let params = "{\"threshold\": 0.8, \"preprocessing\": \"normalize\"}";
		let metadata = "{\"dataset\": \"ChestX-ray14\", \"framework\": \"TensorFlow\"}";
		let loading = false;
		let modelIds = [];
		$$renderer.push(`<div class="max-w-2xl space-y-6"><div><h2 class="text-xl font-semibold text-slate-800">Log Inference</h2> <p class="text-sm text-slate-500 mt-1">Record a model inference event on the blockchain</p></div> <form class="space-y-4"><div><label class="field-label" for="inf-modelId">Model ID *</label> `);
		if (modelIds.length) {
			$$renderer.push("<!--[0-->");
			$$renderer.select({
				id: "inf-modelId",
				value: modelId,
				class: "field-input"
			}, ($$renderer) => {
				$$renderer.option({ value: "" }, ($$renderer) => {
					$$renderer.push(`— Select a model —`);
				});
				$$renderer.push(`<!--[-->`);
				const each_array = ensure_array_like(modelIds);
				for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
					let id = each_array[$$index];
					$$renderer.option({ value: id }, ($$renderer) => {
						$$renderer.push(`${escape_html(id)}`);
					});
				}
				$$renderer.push(`<!--]-->`);
			});
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<input id="inf-modelId" type="text" required=""${attr("value", modelId)} class="field-input" placeholder="chest-xray-classifier-v1"/>`);
		}
		$$renderer.push(`<!--]--></div> <div><div class="flex items-center justify-between mb-1.5"><label class="field-label mb-0" for="inf-input">Input Hash *</label> <button type="button" class="text-xs text-blue-600 hover:text-blue-800 font-medium">⟳ Generate</button></div> <textarea id="inf-input" required=""${attr("rows", 2)} class="field-input font-mono text-xs" placeholder="a1a1a1…">`);
		const $$body = escape_html(input);
		if ($$body) $$renderer.push(`${$$body}`);
		$$renderer.push(`</textarea></div> <div><div class="flex items-center justify-between mb-1.5"><label class="field-label mb-0" for="inf-output">Output Hash *</label> <button type="button" class="text-xs text-blue-600 hover:text-blue-800 font-medium">⟳ Generate</button></div> <textarea id="inf-output" required=""${attr("rows", 2)} class="field-input font-mono text-xs" placeholder="d2d2d2…">`);
		const $$body_1 = escape_html(outputHash);
		if ($$body_1) $$renderer.push(`${$$body_1}`);
		$$renderer.push(`</textarea></div> <div class="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label class="field-label" for="inf-params">Parameters (JSON)</label> <textarea id="inf-params"${attr("rows", 3)} class="field-input font-mono text-xs" placeholder="threshold, preprocessing...">`);
		const $$body_2 = escape_html(params);
		if ($$body_2) $$renderer.push(`${$$body_2}`);
		$$renderer.push(`</textarea></div> <div><label class="field-label" for="inf-meta">Metadata (JSON)</label> <textarea id="inf-meta"${attr("rows", 3)} class="field-input font-mono text-xs" placeholder="dataset, framework...">`);
		const $$body_3 = escape_html(metadata);
		if ($$body_3) $$renderer.push(`${$$body_3}`);
		$$renderer.push(`</textarea></div></div> <button type="submit"${attr("disabled", loading, true)} class="btn-primary w-full">${escape_html("Execute & Log Inference")}</button></form> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
//#region src/lib/components/ProvenanceViewer.svelte
function ProvenanceViewer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { initialModelId = "" } = $$props;
		let modelId = initialModelId ?? "";
		let loading = false;
		let verifying = false;
		let modelIds = [];
		let filterType = "";
		let filterFrom = "";
		let filterTo = "";
		$$renderer.push(`<div class="max-w-3xl space-y-6"><div><h2 class="text-xl font-semibold text-slate-800">View Provenance</h2> <p class="text-sm text-slate-500 mt-1">Query the complete audit trail of a model from the blockchain</p></div> <div class="flex gap-2 flex-wrap">`);
		if (modelIds.length) {
			$$renderer.push("<!--[0-->");
			$$renderer.select({
				value: modelId,
				class: "field-input flex-1 min-w-0"
			}, ($$renderer) => {
				$$renderer.option({ value: "" }, ($$renderer) => {
					$$renderer.push(`— Select a model —`);
				});
				$$renderer.push(`<!--[-->`);
				const each_array = ensure_array_like(modelIds);
				for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
					let id = each_array[$$index];
					$$renderer.option({ value: id }, ($$renderer) => {
						$$renderer.push(`${escape_html(id)}`);
					});
				}
				$$renderer.push(`<!--]-->`);
			});
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<input type="text"${attr("value", modelId)} class="field-input flex-1" placeholder="Enter Model ID…"/>`);
		}
		$$renderer.push(`<!--]--> <button${attr("disabled", !modelId.trim(), true)} class="btn-primary">${escape_html("Search")}</button> <button${attr("disabled", verifying, true)} class="btn-secondary">${escape_html("Verify Chain")}</button> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div> <details class="card"><summary class="px-5 py-3 text-sm font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-50 rounded-xl">🔎 Filters `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></summary> <div class="px-5 pb-5 pt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100"><div><label class="field-label" for="prov-type">Event type</label> `);
		$$renderer.select({
			id: "prov-type",
			value: filterType,
			class: "field-input text-sm"
		}, ($$renderer) => {
			$$renderer.option({ value: "" }, ($$renderer) => {
				$$renderer.push(`All types`);
			});
			$$renderer.option({ value: "model_registration" }, ($$renderer) => {
				$$renderer.push(`Registration`);
			});
			$$renderer.option({ value: "inference" }, ($$renderer) => {
				$$renderer.push(`Inference`);
			});
		});
		$$renderer.push(`</div> <div><label class="field-label" for="prov-from">From</label> <input id="prov-from" type="date"${attr("value", filterFrom)} class="field-input text-sm"/></div> <div><label class="field-label" for="prov-to">To</label> <input id="prov-to" type="date"${attr("value", filterTo)} class="field-input text-sm"/></div></div> <div class="px-5 pb-4 flex gap-2"><button${attr("disabled", !modelId.trim() || loading, true)} class="btn-primary text-sm py-2">Apply filters</button> <button class="btn-outline text-sm py-2">Clear</button></div></details> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[1-->");
		$$renderer.push(`<div class="card py-16 text-center text-slate-400"><div class="text-3xl mb-3">🔍</div> <p class="text-sm">Select a model or enter an ID to view its provenance trail</p></div>`);
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
//#region src/routes/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let activeTab = "register";
		let stats = null;
		let selectedModelId = "";
		async function loadStats() {
			try {
				stats = await getChainStats();
			} catch (e) {
				console.error("Error loading stats:", e);
			}
		}
		$$renderer.push(`<div class="min-h-screen bg-slate-50"><header class="bg-blue-900 shadow-lg"><div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5"><div class="flex items-center gap-6"><div class="flex-1"><div class="flex items-center gap-3"><div class="w-9 h-9 bg-sky-400 rounded-lg flex items-center justify-center font-bold text-blue-900 text-lg">E</div> <div><h1 class="text-xl font-bold text-white tracking-tight">Ernest</h1> <p class="text-xs text-blue-200 leading-none mt-0.5">AI Provenance · Blockchain</p></div></div></div> <nav class="flex items-center gap-2"><a href="/models" class="btn-ghost text-sm py-2 px-4">📚 Models</a> <a href="/stats" class="btn-ghost text-sm py-2 px-4">📊 Statistics</a></nav> `);
		if (stats) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="hidden sm:flex items-center gap-4 pl-4 border-l border-blue-700"><div class="text-center"><div class="text-lg font-bold text-sky-300">${escape_html(stats.totalBlocks)}</div> <div class="text-xs text-blue-300">Blocks</div></div> <div class="text-center"><div class="text-lg font-bold text-sky-300">${escape_html(stats.totalModels)}</div> <div class="text-xs text-blue-300">Models</div></div> <div class="text-center"><div${attr_class(`text-lg font-bold ${stats.chainValid ? "text-emerald-400" : "text-red-400"}`)}>${escape_html(stats.chainValid ? "✓" : "✗")}</div> <div class="text-xs text-blue-300">Chain</div></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div></div></header> <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"><div class="card overflow-hidden"><div class="border-b border-slate-200 bg-slate-50/50"><nav class="flex"><!--[-->`);
		const each_array = ensure_array_like([
			{
				id: "register",
				label: "📝 Register Model"
			},
			{
				id: "inference",
				label: "🔬 Log Inference"
			},
			{
				id: "provenance",
				label: "🔍 View Provenance"
			}
		]);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let tab = each_array[$$index];
			$$renderer.push(`<button${attr_class(`px-6 py-3.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-blue-700 text-blue-700 bg-white" : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"}`)}>${escape_html(tab.label)}</button>`);
		}
		$$renderer.push(`<!--]--></nav></div> <div class="p-6">`);
		if (activeTab === "register") {
			$$renderer.push("<!--[0-->");
			ModelRegistration($$renderer, { onSuccess: (id) => {
				loadStats();
				selectedModelId = id;
				activeTab = "inference";
			} });
		} else if (activeTab === "inference") {
			$$renderer.push("<!--[1-->");
			InferenceLogger($$renderer, {
				initialModelId: selectedModelId,
				onSuccess: (id) => {
					loadStats();
					selectedModelId = id;
					activeTab = "provenance";
				}
			});
		} else {
			$$renderer.push("<!--[-1-->");
			ProvenanceViewer($$renderer, { initialModelId: selectedModelId });
		}
		$$renderer.push(`<!--]--></div></div></main></div>`);
	});
}
//#endregion
export { _page as default };
