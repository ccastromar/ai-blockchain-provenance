// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ErnestMerkleAnchor
/// @notice Registry universal para anclar raíces Merkle de cualquier organización o sector.
contract ErnestMerkleAnchor {
    /// @dev Evento emitido al anclar un root.
    event Anchored(
        address indexed org,      // Wallet técnica de la organización
        bytes32 merkleRoot,       // Raíz Merkle anclada
        string indexed organizationId, // Identificador (público) de la organización (hospital, banco, planta energía)
        string organizationName,   // Nombre legible de la organización
        string domain,            // Dominio/sector (salud, banca, energía, supply chain, etc)
        uint256 timestamp
    );

    /// @dev Anclar una nueva raíz Merkle.
    function anchorRoot(
        bytes32 root,
        string calldata organizationId,
        string calldata organizationName,
        string calldata domain
    ) external {
        emit Anchored(msg.sender, root, organizationId, organizationName, domain, block.timestamp);
    }
}

