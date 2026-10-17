<div align="center">

# Maus Droid Models

**Authorized Droid models, per-model reasoning effort, and credit multipliers
for OpenMausBot — in your own chat app.**

[Features](#features) · [Install](#install-or-reapply-after-an-update) · [Tests](#tests) · [Limitations](#known-droid-limitation) · [License](#license-and-attribution)

![License](https://img.shields.io/badge/license-Apache--2.0-blue) ![OpenMausBot](https://img.shields.io/badge/validated_with-OpenMausBot_0.1.110-8a2be2) ![Droid](https://img.shields.io/badge/validated_with-Droid_0.243.0-4c8bf5) ![Node](https://img.shields.io/badge/node-24+-3c873a)

English | [Português (Brasil)](README.pt-BR.md)

A standalone patch that integrates authorized **Factory Droid** models into
**OpenMausBot**, with per-model reasoning effort selection and credit multipliers
in model names.

This is not a full fork of OpenMausBot and does not include the Droid binary.

</div>

## Features

- Queries `droid.list_models` using the account already signed in to Droid.
- Filters out blocked models and prevents settings from reintroducing them.
- Preserves custom models, favorites, and the configured default when allowed.
- Reuses the instance's last valid catalog if a query fails.
- Adds multipliers such as `Inkling · 0.4x` and `GLM-5.3-Flash · 0.06x`.
- Displays `Dynamic` for automatic routing, without estimating prices for custom models.
- Uses the existing variant picker for the effort levels advertised by each model.
- Selects the model and effort over ACP, confirming the settings before the prompt.
- Preserves model selection for background memory calls.

The model count and multipliers come from Droid. This project does not maintain
a fixed list of authorized models. The multiplier is a relative reference,
**not the final cost of a message**.

## Compatibility and requirements

Validated with **OpenMausBot 0.1.110**, **Droid 0.243.0**, and **Node.js 24** on Linux.

Requires `python3`, GNU `patch`, `node`, and an OpenMausBot installation.
Droid must be installed and authenticated to query models or generate real
responses. This project does not include or ask for your credentials.

The patch only changes:

- `dist-server/index.js`, the bundle executed by the server.
- `dist-server/server/drivers/acp/droid.js`, the equivalent driver.

It does not change the frontend, settings, cache, or authentication. It does not
restart the server.

## Install or reapply after an update

Clone outside the npm package directory so updates do not remove the patch:

```sh
git clone https://github.com/soaresfellipe/maus-droid-models.git
cd maus-droid-models
```

The default installation directory is `~/.local/lib/node_modules/openmausbot`:

```sh
python3 reapply.py --check
python3 reapply.py
```

If your global npm installation uses a different location:

```sh
python3 reapply.py --root "$(npm root -g)/openmausbot" --check
python3 reapply.py --root "$(npm root -g)/openmausbot"
```

Then restart OpenMausBot when you can interrupt conversations and refresh
Droid's models in the UI. The picker should show the multipliers and the effort
options for the selected model.

Run the reapplier again after updating the npm package. **Do not force the patch**
if a future release has already fixed the issue or changed the driver.

## Safe reapplication

- Applies to temporary copies first and validates both files with `node --check`.
- Accepts line offsets, but not context differences (`--fuzz=0`).
- Leaves the installation unchanged with `--check` or when the full patch is already applied.
- Stops on incompatible code, a partial application, or invalid syntax.
- Checks whether files have changed during the operation.
- Creates timestamped UTC backups before replacing files.
- Attempts to restore the first file if writing the second one fails.

Each replacement is atomic, but the two files do not form a single transaction.
If another process changes a file during rollback, the reapplier preserves that
change and reports that manual restoration is required. Do not run it alongside
an npm update.

An installation with only the earlier, catalog-only version of this patch is
not recognized as fully patched. The reapplier stops without changing any files.
After an npm update restores the original files, it can apply the complete patch.

## Tests

The seven reapplier tests use only fixtures in temporary directories:

```sh
python3 test_reapply.py
```

The Node tests read an **already patched** OpenMausBot installation. They use
the same default directory as the reapplier. For another location, set
`OPENMAUSBOT_ROOT`:

```sh
node --test tests/models.test.mjs tests/metadata.integration.test.mjs

# Alternative for a global installation in another location:
OPENMAUSBOT_ROOT="$(npm root -g)/openmausbot" \
  node --test tests/models.test.mjs tests/metadata.integration.test.mjs
```

By default, these tests do not query the account or generate real responses.
The integration test uses the driver extracted from the bundle and a simulated
CLI, without starting another server. This extraction depends on the bundle
structure of the validated version.

### Optional live tests

**These may consume credits.** They use the existing local authentication
without saving it in the repository. The default executable is `droid`; use
`DROID_CLI` for a different path.

```sh
DROID_MODELS_LIVE=1 node --test tests/models.test.mjs
DROID_METADATA_LIVE=1 node --test tests/metadata.integration.test.mjs
```

Inkling's `low` and `high` levels were confirmed over ACP, with real responses
and effort changes within the same session. The tests also cover filtering,
multipliers, custom models, failures, instance isolation, idempotent
reapplication, and rejection of variants that are not advertised.

Do not publish `.factory`, `.openmausbot`, `.env`, logs, cache, or credentials.
These are not part of the project.

## Known Droid limitation

In Droid **0.243.0**, Inkling advertises `minimal` and accepts that value in its
ACP configuration, but the backend may reject it when generating a response.
This rejection was reproduced directly in Droid, without OpenMausBot. `low`
and `high` were confirmed with real responses.

The patch displays the levels advertised by Droid and **does not silently
substitute another level** when one is rejected. Not every level of every model
has been tested.

## Revert

Restore **both backups from the same run**, using the paths printed by the
reapplier, then restart the server. Use backups from the currently installed
version, not from an older OpenMausBot release.

## License and attribution

Apache-2.0. The patch and reference fixtures are derived from the
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) driver, distributed under
Apache-2.0. See `LICENSE` and `NOTICE`.

This is an independent project, not officially affiliated with OpenMausBot or Factory.
