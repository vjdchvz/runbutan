# Security

If you find a security problem in RUNbutan, please report it privately through GitHub's
**Security → Report a vulnerability** on this repository instead of opening a public issue.

Things that are public by design and are not vulnerabilities:

- The Firebase web configuration in `.env` and the Google OAuth client IDs. Access to data is
  controlled by the Firestore Security Rules in `firestore.rules`, not by hiding these values.
- `keystores/debug.keystore`: the standard Android debug signing key (password `android`), used so
  that CI builds can update one another. See `keystores/README.md`.
