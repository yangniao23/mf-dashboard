# Linkx and Bitwarden setup

Use this guide to configure the crawler for a Linkx service account. Keep credentials, session values, database files, and transaction data on the local machine; do not commit them or paste them into chat.

## Configuration

Set these values in the local `.env` file:

```dotenv
MF_SERVICE=linkx
CREDENTIAL_PROVIDER=bitwarden
BW_ITEM_ID=<Bitwarden Login item UUID>
BROWSER_EXECUTABLE_PATH=<path to an installed Chromium browser>
```

Configure `BW_CLI_PATH` if the Bitwarden CLI is not available on `PATH`. Set `BW_SESSION` only in the runtime environment after unlocking Bitwarden. Do not save it in `.env`.

The Bitwarden Login item should contain the service username and password. If the service requires TOTP, add a TOTP value to that item. The crawler retrieves credentials at runtime and does not print them to logs. Additional authentication steps that cannot be handled automatically stop the login flow.

## Run the crawler

Unlock Bitwarden in a local terminal and start the crawler with the repository's normal command. The session variable is inherited by the crawler process; clear it after the run. Keep the database path and generated database files local and ignored by Git.

## Category writeback

Category writeback is an explicit operation. First generate and inspect a dry-run report, then apply it only with the required confirmation flag. Reports can contain transaction details and identifiers, so store them locally and do not commit or share them. Re-fetch the affected period afterward to verify the changes.
