# Clerk Authentication Setup

The web dashboard uses Clerk for sign-in and passes the Clerk session token to Supabase. GitHub App authorization remains a separate connection used only for repository operations.

## Environment

Configure these variables in each web deployment environment:

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

Only the variables beginning with `NEXT_PUBLIC_` may be exposed to the browser.

## Activate Clerk With Supabase

1. Open the Clerk Dashboard for the Agent God Mode instance.
2. Open **Integrations → Supabase**, activate the native integration, and copy the displayed Clerk domain.
3. In Supabase, open **Authentication → Sign In / Providers → Third Party Auth**.
4. Add **Clerk**, paste the Clerk domain, and save.

Do not create a legacy Supabase JWT template. The application uses Clerk's native Supabase integration.

## Apply The Identity Migration

Apply `supabase/migrations/20260905000000_clerk_auth.sql` before deploying the Clerk-authenticated application. It:

- Preserves existing records under their current internal owner UUID.
- Links a Clerk user to an existing owner on the first request when the verified email matches.
- Creates a provider-neutral owner UUID for new Clerk users.
- Resolves RLS ownership from the Clerk JWT `sub` claim.
- Keeps identity and credential tables inaccessible to browser clients.

After migration, sign in once and confirm that existing workstreams load. Then test a second Clerk account and verify it cannot read the first account's records.
