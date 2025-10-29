import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ErnestMerkleAnchorModule", (m) => {
  // despliega el contrato, sin constructor params
  const merkleAnchor = m.contract("ErnestMerkleAnchor", []);
  return { merkleAnchor };
});
