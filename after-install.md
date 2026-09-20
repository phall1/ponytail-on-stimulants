# Ponytail on Stimulants for Hermes installed

Enable it if installation did not use `--enable`:

```sh
hermes plugins enable ponytail-on-stimulants
```

Restart Hermes or the gateway. In shared gateways, restrict the fork's slash commands to trusted users.

Commands use the unique `/ponytail-on-stimulants*` namespace. Modes are `focused`, `full-send`, `feral`, and `off`; `full-send` is the default. Bundled skills are exposed under the `ponytail-on-stimulants:` namespace.
