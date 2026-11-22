# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

The integration stores under `/data` only the Dify conversation ids of the
conversations named in scenes (`conversations.json`), never a message. The
address of Dify and the API keys of the apps live in the configuration of the
integration, in Gladys; the keys are sent only to that Dify server, as Bearer
tokens, and never written to the logs or the device ids (a hash is used), nor
are the inputs, the messages and the answers. The integration only talks to
the Dify server, on your network, behind your reverse proxy or Dify Cloud: use
HTTPS when it is reached over the internet. An app key lets anyone run that
app (and spend its model quota): keep it secret, revoke it in Dify if it
leaks.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Dify and the models and tools its apps call.
