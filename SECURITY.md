# Security Policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue.

Use GitHub's **Report a vulnerability** button on this repo's Security tab.

Include what you found, how to reproduce it, and the impact you think it has.
I'll acknowledge your report within 7 days and keep you updated until it's fixed.

## Scope

In scope: the code in this repo and the site at https://www.techeventsapp.us,
including the event data loading, the ingestion job in `ingest/`, and the
database access rules in `supabase/`.

Out of scope: Vercel, Supabase and GitHub themselves (report those to the
vendor), denial-of-service testing, and automated scanning that generates
heavy traffic.

## Supported versions

Only the latest version on `main` is supported.
