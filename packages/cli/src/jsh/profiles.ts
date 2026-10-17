export const default_profile = `
# default profile
source /etc/util.sh
source /etc/jsh-default.sh
source /etc/alias.sh
awaitWorld
predicates
inventory
sidestep

`.trim();

export const empty_profile = `
# empty profile: maybe source something?
# source /etc/util.sh
# source /etc/jsh-default.sh
# source /etc/alias.sh
`.trim();

export type ProfileKey = keyof typeof import("./profiles");
