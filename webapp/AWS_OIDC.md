# AWS OIDC operator setup

Agent God Mode uses short-lived AWS sessions. The web app exchanges its Vercel OIDC identity for the app broker role, then assumes the restricted IAM role created for a specific AWS account connection. No AWS access key is configured in Vercel or collected from a user.

## 1. Use the team-scoped Vercel OIDC issuer

In the Vercel project, open **Settings → Security → Secure Backend Access with OIDC** and select the team issuer. The AWS credential provider requests the dedicated `sts.amazonaws.com` audience; Vercel's audience exchange issues that token from `https://oidc.vercel.com/YOUR_TEAM_SLUG`. The broker template intentionally trusts only that issuer and the production subject for one Vercel team and project.

## 2. Deploy the broker in the operator AWS account

Replace the two placeholder values and run:

```sh
AWS_PROFILE=personal aws cloudformation deploy \
  --region us-east-1 \
  --stack-name agent-god-mode-oidc-broker \
  --template-file webapp/public/aws/agent-god-mode-operator-broker.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    VercelTeamSlug=YOUR_VERCEL_TEAM_SLUG \
    VercelProjectName=YOUR_VERCEL_PROJECT_NAME
```

Read the broker ARN:

```sh
AWS_PROFILE=personal aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name agent-god-mode-oidc-broker \
  --query 'Stacks[0].Outputs[?OutputKey==`BrokerRoleArn`].OutputValue' \
  --output text
```

## 3. Configure the web deployment

Set these server-only environment variables in the production Vercel project:

```text
AWS_BROKER_ROLE_ARN=arn:aws:iam::123456789012:role/AgentGodModeBroker
AWS_BROKER_REGION=us-east-1
```

Preview and local AWS access stays disabled unless their OIDC subjects are explicitly added to the broker trust policy.

## 4. Apply the database migration

Apply `supabase/migrations/20260904000000_aws_oidc_provisioning.sql` to the Agent God Mode Supabase project before enabling the UI. The external ID is encrypted in the server-only `aws_connection_secrets` table; browser sessions have no policy granting access to that table.

## What customers do

Users open **Settings → AWS accounts**, create a connection, and either run the guided AWS setup or reveal the exact trust and permissions JSON in copy/paste boxes. The full access stack also creates the restricted CloudFormation execution role and EC2 Session Manager instance role required for managed host deployment.

Deleting a managed host deletes its CloudFormation stack and encrypted EBS volume. Disconnecting an AWS account removes the app's encrypted external ID, but the user must also delete the `agent-god-mode-access-*` stack in AWS to remove its IAM roles completely.
