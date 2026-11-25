# Deploying OrderFlow to AWS

How to run OrderFlow on your own AWS account with real email (Amazon SES), document storage (Amazon S3), a managed database (Amazon RDS for MySQL) and scheduled reminders (Amazon EventBridge Scheduler). Everything is created by one CloudFormation template, [infra/orderflow.yaml](../infra/orderflow.yaml). Nothing is clicked together in the console.

The laptop version keeps working exactly as before: with no AWS settings, `npm run dev` uses SQLite, a local folder and the Outbox page.

> **Costs money.** The stack runs a small EC2 server and a small RDS database around the clock until you stop or delete them. Check the [AWS Pricing Calculator](https://calculator.aws/) for your region, and see "Saving money" below. A budget alert emails you at 80% of the monthly budget (default USD 30).

## What gets created

| Piece | Service | Used by |
|---|---|---|
| App server: Amazon Linux 2023, Node.js 22, the Next.js app as a service, fixed public IP | EC2, Elastic IP | Every story |
| Database: MySQL 8.4, encrypted, TLS required, private subnets, 7 days of backups | RDS for MySQL | Every story |
| PDFs (POs, proofs of payment, shipping documents): private, encrypted, versioned | S3 | Story 4 (proofs), stories 1 and 5 |
| Email: Janet's approval link and reminders, payment reminders, the warehouse notice | SES | Stories 3 and 4 |
| Due jobs every 5 minutes: SPR reminders at 24 and 48 hours, hand-over at 72 | EventBridge Scheduler + Systems Manager | Story 3 (and the alerts of stories 4 to 6) |
| Database password, approval-link secret, jobs secret | Secrets Manager | Server setup |
| Network: VPC, public subnets for the server, private subnets for the database | VPC | |
| Monthly budget alert; automatic recovery if the server's host fails | Budgets, CloudWatch | |

[ARCHITECTURE.md](ARCHITECTURE.md) explains the design and how it meets the AWS Well-Architected pillars.

## Before you start

1. **AWS CLI v2, signed in.** Run `aws configure` (access key) or `aws configure sso` (single sign-on), then check with `aws sts get-caller-identity`. Your keys stay in `C:\Users\<you>\.aws\`, never in this project or in Git. If the check says `ExpiredToken`, sign in again (`aws sso login`, or new keys).
2. **Pick a region.** `ap-southeast-1` (Singapore) is closest to Spectra; your CLI's default may be another one. Use the same region in every command below.
3. **The code must be on GitHub, public, on the branch you deploy.** The server clones it on first boot (`RepoUrl`, `RepoBranch` parameters). Push before you deploy.
4. **Two email addresses you can open:** `SenderEmail` (what OrderFlow sends from) and `DemoInbox` (where every email goes; the people in the sample data have made-up addresses). They may be the same address.
5. **Your public IP**, so only you can open the app (it has no real login yet): `curl https://checkip.amazonaws.com`, then add `/32`.

## Deploy

From the project folder. Bash or Git Bash (in PowerShell, put each command on one line and drop the `\`):

```bash
aws cloudformation deploy \
  --region ap-southeast-1 \
  --stack-name orderflow \
  --template-file infra/orderflow.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    AllowedCidr=203.0.113.25/32 \
    SenderEmail=you@example.com \
    DemoInbox=you@example.com
```

It takes 25 to 40 minutes: the database alone takes about 10, then the server installs, creates the tables, loads the demo data and builds the app. The stack only finishes when the app answers, so a finished stack is a working app.

**While it runs, open your mailbox.** SES sends a verification email to `SenderEmail` (and to `DemoInbox` if it is different). Click the links. No email can be sent until you do.

When it is done:

```bash
aws cloudformation describe-stacks --region ap-southeast-1 --stack-name orderflow --query "Stacks[0].Outputs" --output table
```

Open `AppUrl` (for example `http://54.x.x.x:3000`).

## Try stories 3 and 4 on AWS

**Story 3: SPR approval by email.**
1. Pick **Priya Nair**, SPRs, "Open pre-filled SPR", give a reason, **Submit to Janet**.
2. Within a minute an email arrives in `DemoInbox`: "[OrderFlow test] SPR-0006: approval needed for ...". The first line says it would have gone to Janet.
3. Click the link in the email. It opens the app (from an address inside `AllowedCidr`) without a login. Approve or reject: Priya gets the decision by email.
4. Reminders: leave an SPR undecided. EventBridge Scheduler runs the due jobs every 5 minutes, so the 24-hour reminder arrives 24 hours later. To see it sooner, press **+24 h** in the top bar; the next scheduled run (or the button itself) sends it.

**Story 4: payments.**
1. Pick **Farah Lim**, Payments, open ORD-1034, **Confirm paid**. The warehouse email arrives in `DemoInbox`.
2. Upload a proof of payment on the Inbox page: the PDF is stored in the S3 bucket (`DocumentBucketName` output; look in the S3 console under `documents/`).
3. ORD-1036's payment reminder draft: review it and click **Send**; it is emailed then, not before.

The **Outbox** page still lists every message. On AWS it also shows whether SES accepted it, or why not.

## Looking inside the server

There is no SSH and no open port 22. Use Session Manager (install the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) once):

```bash
aws ssm start-session --region ap-southeast-1 --target <InstanceId output>
sudo tail -n 100 /var/log/orderflow-setup.log     # first-boot setup
sudo journalctl -u orderflow -n 100                # the running app
sudo /usr/local/bin/orderflow-run-jobs             # run the due jobs now
```

Each scheduled run is also listed under Systems Manager, Run Command, Command history.

## Updating the app

After you push to the branch the server uses:

```bash
aws ssm send-command --region ap-southeast-1 --instance-ids <InstanceId> --document-name AWS-RunShellScript \
  --parameters 'commands=["/usr/local/bin/orderflow-update"]'
```

`orderflow-update` ([infra/ec2/update.sh](../infra/ec2/update.sh)) fetches the code, installs, applies new database migrations, builds and restarts. It never reloads the demo data. With continuous deployment switched on (below), a push to `main` does all of this for you.

## Continuous integration and deployment

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on every push and pull request: typecheck, lint, the Vitest suite, the golden test, the Playwright end-to-end tests, and `cfn-lint` on the templates. It needs no setup.

Deployment from GitHub is switched off until you set it up, once:

1. Create the deploy role: GitHub signs in to AWS with a short-lived token, so no AWS keys are stored in GitHub.
   ```bash
   aws cloudformation deploy --region ap-southeast-1 --stack-name orderflow-github-deploy \
     --template-file infra/github-deploy-role.yaml --capabilities CAPABILITY_IAM \
     --parameter-overrides GitHubRepository=AlvinChang94/ECP-26S2 AppStackName=orderflow
   ```
   (Add `CreateOidcProvider=false` if the account already trusts GitHub's token provider.)
2. In the GitHub repository, Settings, Environments: create an environment called `aws`.
3. Settings, Secrets and variables, Actions:
   - secret `AWS_DEPLOY_ROLE_ARN` = the `DeployRoleArn` output of step 1;
   - variables `DEPLOY_ENABLED=true`, `AWS_REGION`, `STACK_NAME=orderflow`, `ALLOWED_CIDR`, `SENDER_EMAIL`, `DEMO_INBOX`.

From then on, a push to `main` that passes every check updates the stack and the app.

## Saving money

- **Between demos**, stop the server and the database (their data is kept):
  ```bash
  aws ec2 stop-instances --region ap-southeast-1 --instance-ids <InstanceId>
  aws rds stop-db-instance --region ap-southeast-1 --db-instance-identifier <database id, from the RDS console>
  ```
  Start them again with `start-instances` and `start-db-instance`. AWS starts a stopped database again by itself after 7 days. The Elastic IP keeps the same address. Storage and backups are still charged while stopped.
- **When the project is over**, delete the stack: `aws cloudformation delete-stack --region ap-southeast-1 --stack-name orderflow`. Two things are kept on purpose and must be deleted by hand: the S3 bucket (empty it first) and the database's final snapshot (RDS console, Snapshots).

## When something goes wrong

| You see | Why | Do this |
|---|---|---|
| The stack fails on `AppInstance` ("did not receive the required number of signals") | The first-boot setup failed | Open a Session Manager shell and read `/var/log/orderflow-setup.log`. The stack rolls back; fix the cause and deploy again. |
| `git clone` failed in the setup log | The repository is private, or the branch does not exist | Make it public, or point `RepoUrl`/`RepoBranch` at a public copy. |
| Outbox says "SES could not send it: MessageRejected" | An address is not verified, or the account is in the SES sandbox | Click the verification emails; keep `DemoInbox` as the test recipient. |
| The app does not open | Your IP changed, or the server is stopped | Check `curl https://checkip.amazonaws.com`, then deploy again with the new `AllowedCidr`. |
| Prisma says it cannot open a TLS connection | The RDS certificate bundle is missing | Check that `/etc/orderflow/rds-global-bundle.pem` exists; rerun the download line from `infra/ec2/setup.sh`. |
| `ExpiredToken` from the AWS CLI | Your sign-in expired | `aws sso login` or new keys, then repeat the command. |

## Security, in short

- No AWS keys anywhere in the project. The server uses its IAM role; GitHub uses a short-lived role; the database password, the approval-link secret and the jobs secret live in Secrets Manager and are written only to the server's `.env` (readable by the app's own user).
- The database is in private subnets with no internet route, accepts only the app server, and only over TLS.
- The bucket blocks all public access and refuses unencrypted connections.
- The persona picker is **not** a login. Keep `AllowedCidr` to your own address. Amazon Cognito sign-in is the planned replacement ([AWS_MAPPING.md](AWS_MAPPING.md)).
