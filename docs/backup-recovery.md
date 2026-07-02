# Backup & Recovery

Ernest's hashchain lives in MongoDB. The optional Ethereum anchor only proves that a
Merkle root existed at a point in time — it does not let you reconstruct block
contents. If MongoDB is lost without a backup, the evidence itself is gone, even with
a valid anchor sitting on-chain.

## What to back up

The whole `ernest` database: `provenanceblocks`, `anchors`, `integritychecks`,
`aimodels`, `ingested_events`, `event_failures`. `mongodump` handles all of it in one
shot — there's no value in cherry-picking collections.

## Backup

```bash
./scripts/backup-mongo.sh
```

Writes a timestamped, gzip-compressed archive to `backups/` (gitignored — these can
contain evidence data and should not land in version control). Override the container
or database name with `MONGO_CONTAINER` / `MONGO_DB_NAME` if you're not using the
default `docker-compose.yml` setup.

## Restore

```bash
./scripts/restore-mongo.sh <backup-file>
```

**Destructive**: drops the target database before restoring. The script requires
typing the database name to confirm. Point it at a full path or just a filename
inside `backups/`.

## After restoring

A restore lands the chain in whatever state it was in at backup time — verify it
before trusting it:

```bash
curl -s http://localhost:3001/health | python3 -m json.tool   # check the integrity subsystem
curl -s http://localhost:3001/api/verify | python3 -m json.tool
```

If you anchor to Ethereum, an anchor whose `lastBlockIndex` is past the restored
chain's tip is expected and not an error — it just means those later blocks weren't
included in this particular backup.

## Recommended cadence

There's no scheduled backup job included on purpose — this is a script, not a new
always-on service to operate. Wire it into whatever scheduler you already run, for
example host cron:

```cron
# /etc/cron.d/ernest-backup — daily at 03:00
0 3 * * * cd /path/to/ai-blockchain-provenance && ./scripts/backup-mongo.sh >> /var/log/ernest-backup.log 2>&1
```

Match the cadence to how much evidence you can afford to lose between backups, and
store the resulting archives somewhere other than the same host as the database.
