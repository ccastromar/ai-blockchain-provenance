# 🛡️ AI Model Provenance & Auditing PoC

Welcome to the AI Model Provenance & Auditing Proof-of-Concept—a full-stack platform to **trace, audit, and anchor the lifecycle of AI models and their inferences**.

## Why This Project?

In fields like healthcare, finance, and industry, **provenance and transparency for AI models are becoming mission-critical**—not just recommended. Regulations (EU AI Act, FDA, GDPR) and the drive for *trustworthy AI* demand that every decision, model update, and inference can be traced, reproduced, and publicly verified.

## What Does This PoC Offer?

- **Track every model, version, parameter & inference.**
- **Anchor immutable digests (Merkle root) in a public blockchain (Ethereum testnet),** providing tamper-evidence and future-proof proof of existence.
- **Generalist UI & API:** Ready to integrate any model, data type, or business logic—AI-native but extensible to *any provenance use case*.
- **Modern stack:** Fast back-end (NestJS/Node.js + MongoDB), intuitive (React/Next.js) front-end.
- **Auditable & extensible:** Designed for easy adaptation in domains where explainability, compliance, and data lineage matter.

## Who Is This For?

- AI engineers, ML Ops & Data Scientists
- Compliance/Risk officers
- CTOs and product leads exploring **“Responsible AI”**
- Anyone who needs auditable, blockchain-anchored history of AI actions

## Quick Start

1. Clone the repo, install dependencies and launch both backend and frontend.
2. Register your models and submit inferences through the API or web dashboard.
3. Review provenance records, Merkle roots, and blockchain anchors in seconds.

## 🎯 Features

- ✅ **Model Registration**: Register AI models with version control
- ✅ **Inference Tracking**: Log every prediction with input/output hashes
- ✅ **Provenance Querying**: Complete audit trail for any model
- ✅ **Chain Verification**: Cryptographic integrity validation
- ✅ **Immutable History**: Tamper-proof record of all events
- ✅ **Web Dashboard**: User-friendly interface for all operations

## 🏗️ Architecture

NestJs and Next

## 🔒 Security Considerations

⚠️ **This is a POC**. For production:

- [ ] Add authentication (JWT/OAuth)
- [ ] Implement access control (RBAC)
- [ ] Encrypt sensitive data
- [ ] Add rate limiting
- [ ] Use real blockchain (e.g., Hyperledger Fabric/EVM)
- [ ] Implement HIPAA compliance
- [ ] Add audit logging
- [ ] Secure API endpoints

## 📝 Future Enhancements

- [ ] Real MLflow integration
- [ ] Smart contracts (Solidity)
- [ ] IPFS for large files
- [ ] Multi-party signatures
- [ ] Consensus mechanism
- [ ] GraphQL API
- [ ] Real-time updates (WebSockets)

## 🤝 Contributing

This is a POC. For improvements:
1. Fork the repo
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit PR

## 📄 License

MIT License - free to use and modify

## 👥 Author

Developed and maintained by Carlos Castro Martos.

This project was developed independently by me.

**This repository is not sponsored, endorsed, or licensed by any employer, organization, or company. All code, ideas, and documentation are personal intellectual property and are published for the benefit of the global open source and AI community.**

## 📞 Support

For issues or questions:
- Create GitHub issue
- Check documentation
- Review API endpoints

---

Copyright © 2025 Carlos Castro Martos. Licensed under MIT, see LICENSE.

**Built with ❤️ for medical AI transparency**
