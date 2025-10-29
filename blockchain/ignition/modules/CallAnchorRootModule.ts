import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("CallAnchorRootModuleV3", (m) => {
  // Usa la dirección del contrato REAL ya desplegado
  const contractAddress = "0xb55F5e61102a6f551BffD015998b02bC0688e41D";
  const merkleAnchor = m.contractAt("ErnestMerkleAnchor", contractAddress);

  // Llama a anchorRoot sobre el contrato en esa dirección
  m.call(merkleAnchor, "anchorRoot", [
    "0x" + "babebeef".padEnd(64, "0"), // Root ejemplo
    "5b87e82b-6f7b-44b3-bf45-93dc84ef7110", // orgId ejemplo
    "hospital-ignition",
    "salud"
  ]);

  return { merkleAnchor };
});
