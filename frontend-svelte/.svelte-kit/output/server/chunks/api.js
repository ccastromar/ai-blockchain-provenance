import axios from "axios";
//#region src/lib/api.ts
var apiUrl = "http://localhost:3001";
var api = axios.create({
	baseURL: `${apiUrl}/api`,
	headers: { "Content-Type": "application/json" }
});
api.interceptors.response.use((r) => r, (err) => {
	if (err.response?.status === 429) {
		const e = /* @__PURE__ */ new Error("Too many requests — please wait a moment and try again.");
		e.isRateLimit = true;
		return Promise.reject(e);
	}
	return Promise.reject(err);
});
var getModels = async (page = 1, limit = 20) => {
	const res = (await api.get("/models", { params: {
		page,
		limit
	} })).data;
	if (Array.isArray(res)) return {
		data: res,
		total: res.length,
		page: 1,
		totalPages: 1
	};
	if (res.items) return {
		data: res.items,
		total: res.total,
		page: res.page,
		totalPages: res.totalPages
	};
	return res;
};
var getAllModels = async () => {
	const res = (await api.get("/models")).data;
	if (Array.isArray(res)) return res;
	return res.items ?? res.data ?? [];
};
var getAllModelIds = async () => (await api.get("/models/ids")).data;
var getProvenance = async (modelId, filters) => (await api.get(`/provenances/${modelId}`, { params: filters })).data;
var getChainStats = async () => (await api.get("/stats")).data;
var verifyChain = async () => (await api.get("/verify")).data;
var getHealth = async () => (await axios.get(`${apiUrl}/health`)).data;
//#endregion
export { getModels as a, getHealth as i, getAllModels as n, getProvenance as o, getChainStats as r, verifyChain as s, getAllModelIds as t };
