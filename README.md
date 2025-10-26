# 🏥 HealthTrace - Medical AI Provenance Blockchain POC

A proof-of-concept system for tracking AI model provenance and medical inferences using blockchain technology (hash chain implementation).

## 🎯 Features

- ✅ **Model Registration**: Register AI models with version control
- ✅ **Inference Tracking**: Log every prediction with input/output hashes
- ✅ **Provenance Querying**: Complete audit trail for any model
- ✅ **Chain Verification**: Cryptographic integrity validation
- ✅ **Immutable History**: Tamper-proof record of all events
- ✅ **Web Dashboard**: User-friendly interface for all operations

## 🏗️ Architecture

NestJs and Next

## What is stored?

In summary:

Parameters: "What values did you use to train?"

Metrics: "How well did the model do?"

Metadata: "Anything else someone should know for context"


### Adding Features

**New block type:**
1. Update `ProvenanceBlock` schema in `blockchain/models/`
2. Add method in `BlockchainService`
3. Create API endpoint in `api/`
4. Update frontend component

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

## 👥 Authors

Carlos Castro Martos for the backend, and my UI specialist, Perplexity AI.

## 📞 Support

For issues or questions:
- Create GitHub issue
- Check documentation
- Review API endpoints

---

**Built with ❤️ for medical AI transparency**
