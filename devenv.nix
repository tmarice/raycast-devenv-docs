{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:

{
  languages = {
    javascript = {
      enable = true;
      package = pkgs.nodejs_24;
      pnpm.enable = true;
    };
  };
}
