# Storage provider migration tool

Best-effort tool that can migrate data between the supported storage providers.
Supports the migration between SQlite, Postgresql and Redis.

The tool will copy all data from the source to destination, and will remove any data
that exists in the destination, but not present in the source.

Hence, you can run this tool multiple times.

## Setup
Clone or copy the full source tree, the migration tool is reusing modules from exposr.

Install dependencies

    > cd tools/migrate
    > yarn install

## Usage
The migration tool takes a source URL and a destination URL as input.

    Usage: migrate.js <source-url> <destination-url> [--dry-run]

    Positionals:
      source-url       Source storage                                                                               [string]
      destination-url  Destination storage                                                                          [string]

    Options:
      --help       Show help                                                                                       [boolean]
      --dry-run    Do not write to destination                                                    [boolean] [default: false]
      --namespace  Namespaces to migrate                          [array] [default: ["tunnel","account","ingress-altnames"]]

    Examples:
      migrate.js redis://localhost:6379 postgres://localhost:5432  Copy from redis to postgres
      migrate.js sqlite://db.sqlite postgres://localhost:5432      Copy from sqlite to postgres

    Both a source and destination is required

### Supported source/destinations
#### SQlite
To reference a SQLite database use the URL syntax `sqlite://<path>`.

For example `sqlite://db.sqlite` or `sqlite:///full/path/to/db.sqlite`.

#### PostgreSQL
To reference a PostgreSQL database use the URL syntax `postgres://<username>:<password>@<hostname>/<database>`.

For example `postgres://pguser:secretpassword@database-server.local:5432/myDatabase`.

#### Redis
To reference a Redis database use the URL syntax `redis://[:<password>]@<hostname>`.

For example `redis://:redispassword@redis-server.local:6379`.

### Examples
Migrate from Redis to Postgres

    > node migrate.js redis://localhost:6379 postgres://postgres:password@localhost:5432/exposr

Migrate from Redis to SQLite

    > node migrate.js redis://localhost:6379 sqlite://db.sqlite