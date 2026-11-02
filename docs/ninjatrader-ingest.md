# NinjaTrader execution ingest

The development server exposes `POST /api/ingest/ninjatrader`. It accepts one
NinjaTrader execution fill per request, including a partial fill. The endpoint
uses the existing reviewed NinjaTrader import, execution storage, and
round-trip rebuild code; it does not insert aggregate trades directly.

## Request schema

Send JSON with these fields:

```json
{
  "executionId": "123456789",
  "instrument": "ES 12-26",
  "action": "Buy",
  "quantity": 1,
  "price": 6800.25,
  "commission": 2.34,
  "executedAt": "2026-11-02T09:30:00-05:00",
  "account": "Sim101",
  "connection": "My Connection",
  "entryExit": "Entry",
  "sequence": 1
}
```

`executionId`, `instrument`, `action`, `quantity`, `price`, `commission`,
`executedAt`, `account`, and `connection` are required. `action` is `Buy` or
`Sell`; `entryExit` is optional and may be `Entry`, `Exit`, or `Reverse`;
`sequence` is an optional non-negative integer used to resolve same-time fills.
The execution ID must be the stable NinjaTrader execution/fill ID, not an order
ID shared by multiple partial fills.

`commission` is required, including when the correct value is zero. The
endpoint does not invent fees, FX conversions, quantity units, or contract
multipliers. The quantity is stored in the units supplied by NinjaTrader.
Futures are identified from the instrument name, but their multiplier must
already be configured in the journal Settings. Unsupported NinjaTrader fields
such as order ID, strategy name, ATM name, and account balances are ignored and
must not be sent.

`executedAt` must be an ISO 8601 timestamp with `Z` or an explicit UTC offset.
The submitted string is stored unchanged, preserving its instant and offset;
the journal's display timezone should be set to `America/Toronto`, which applies
the correct daylight-saving rules to journal dates and times.

## Authentication and account setup

Set these values in the development `.env` (never commit the file):

```dotenv
JOURNAL_NT_INGEST_TOKEN=<long-random-secret>
JOURNAL_NT_ACCOUNT_ID=<existing-account-id>
```

The bearer token is validated before the database is accessed and is never
logged. `JOURNAL_NT_ACCOUNT_ID` must identify an existing journal account; the
endpoint never creates an account. Confirm the value from the development
database or the app's Accounts page. Use the exact database `id`, not the
display name, and do not point this check or the endpoint at the production
volume.

Example request:

```powershell
$body = @{
  executionId = "dev-exec-001"
  instrument = "AAPL"
  action = "Buy"
  quantity = 1
  price = 100
  commission = 0
  executedAt = "2026-11-02T09:30:00-05:00"
  account = "Sim101"
  connection = "Development"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/ingest/ninjatrader `
  -Headers @{ Authorization = "Bearer $env:JOURNAL_NT_INGEST_TOKEN" } `
  -ContentType "application/json" -Body $body
```

The response reports `inserted: 1` for a new fill. Repeating the same stable
execution ID and unchanged facts reports `inserted: 0, duplicates: 1`. Changed
facts for an existing execution ID are rejected. Validation or position-order
conflicts are rejected atomically; no fill is saved. This is the safe way to
verify the route: use a development account, a synthetic execution ID such as
`dev-exec-001`, and a development SQLite directory, then delete that temporary
database afterward. Never test with the production volume or a live trade.

## Later production deployment (do not run now)

Build and replace the application only after reviewing the committed Git
version. Preserve the existing Compose project, LAN port, and named volume:

```powershell
docker compose -p trade-journal build journal
docker compose -p trade-journal up -d --no-deps journal
```

Before running that command, provide the two environment variables through the
existing production Compose configuration or its protected environment-file
mechanism, without committing their values. Keep the service mapped to LAN
port `3100` and keep the data volume named `trade-journal_journal-data`.
The default development server uses port `3000`; use `PORT=3100` if your
development process is configured to use the later LAN port. Inspect the
resolved production configuration first:

```powershell
docker compose -p trade-journal config
docker volume inspect trade-journal_journal-data
```

Do not use `docker compose down -v`, `docker volume rm`, a new Compose project
name, or a changed volume declaration. Those can detach or delete the existing
journal data. Do not run these deployment commands as part of development or
this change.
