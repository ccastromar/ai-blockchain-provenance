# Ernest en 10 minutos — arranque en frío y demo

De cero a la demo completa: clonar, levantar, y el baile de 5 minutos que termina con
un recibo de evidencia verificándose **con el servidor apagado**. Guion hablado con
tiempos: [docs/demo-script.md](docs/demo-script.md).

## Preparación (antes de la audiencia, ~5 min + primera build)

Requisitos: Docker con Compose. Nada más.

```bash
git clone https://github.com/ccastromar/ai-blockchain-provenance.git
cd ai-blockchain-provenance

# Stack completo + cadena EVM local (Hardhat) para anclar con confirmación inmediata
cp .env.local-chain.example .env.local-chain
docker compose -f docker-compose.yml -f docker-compose.local-chain.yml \
  --env-file .env.local-chain up -d --build

docker compose ps        # espera a ver mongodb, backend y frontend "healthy"
open http://localhost:3000
```

Sin claves configuradas el dashboard arranca en modo abierto — perfecto para la demo.
(Para lucir roles y tokens de auditor: añade `ERNEST_API_KEY` y `ERNEST_READ_API_KEY`
a `.env.local-chain`, recrea backend y frontend, y entra por `/login`.)

> La cadena local de Hardhat existe porque el final de la demo necesita un anchor
> **confirmado** al momento. En producción usarías `ANCHOR_PROVIDER=ots`
> (OpenTimestamps: gratis y sin claves), pero sus proofs tardan horas en agregarse
> a Bitcoin — física, no software.

## El baile (5 minutos)

**1. Sembrar evidencia (30s).** Botón **Seed demo** en el dashboard: un modelo de
riesgo de crédito y dos inferencias hash-only entran en la cadena.

**2. Enseñar la cadena vigilada (45s).** Menú **Blocks** → elige un bloque → se ve la
verificación del enlace con el anterior. Menciona lo invisible: check de integridad
horario con checkpoint, revalidación del root anclado, webhook si algo deja de cuadrar.

**3. Anclar (30s).**

```bash
curl -X POST http://localhost:3000/api/anchors
curl http://localhost:3000/api/anchors/status   # mode: local, anchor confirmado
```

Solo 32 bytes (el Merkle root) salen de Ernest. Desde este momento, reescribir la
historia anclada es detectable por cualquiera — incluidos nosotros, los operadores.

**4. El recibo (30s).** En el bloque de una inference → **⬇ Receipt**. Ábrelo: el
bloque, ~una docena de hashes, la transacción del anchor. Eso es todo el expediente.

**5. Verificación en el navegador (45s).** **Verify receipt** (enlace en Blocks) →
arrastra el fichero → checks en verde. Señala: *WebAssembly, nada ha salido del
navegador*.

**6. El momento (60s).**

```bash
docker compose stop backend
```

Recarga el dashboard: muerto. Vuelve a `/verify-receipt` (es estática) y verifica el
recibo otra vez: **sigue en verde**.

> "El auditor no necesita confiar en nuestros servidores, nuestra base de datos ni
> nuestro uptime. La evidencia se sostiene sola, contra una cadena pública."

```bash
docker compose start backend   # y de vuelta
```

**Bis si sobra tiempo:** el mismo recibo por terminal
(`cd cli-ernest && go run . proof verify recibo.json`), o firmar una submission con
clave de emisor (`go run . emitter keygen` + `integrations/signing/sign-submission.mjs`)
y enseñar el "✓ signed by …" en el veredicto.

## Si algo se tuerce

| Síntoma | Remedio |
|---|---|
| Primer `up --build` lento | Normal (5 imágenes); hazlo antes de la reunión |
| Puertos 3000/3001/27017 ocupados | Libéralos o ajusta los mappings del compose |
| "⬇ Receipt" devuelve 409 | Falta el paso 3: el recibo exige un anchor confirmado que cubra el bloque |
| El anchor responde "not configured" | Arrancaste sin el overlay local-chain; repite el `up` con ambos `-f` |

## Recoger

```bash
docker compose -f docker-compose.yml -f docker-compose.local-chain.yml down -v
```

(`-v` borra los volúmenes: la próxima demo vuelve a nacer con génesis limpio.)
