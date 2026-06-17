export const default_profile = `
# default profile
source /etc/util.sh
source /etc/util.js.sh
source /etc/core.js.sh
source /etc/demo.js.sh

`.trim();

export const empty_profile = `
# empty profile: maybe source something?
# source /etc/util.sh
# source /etc/util.js.sh
# source /etc/core.js.sh
# source /etc/demo.js.sh

`.trim();

export const world_profile_v0 = `
# world profile v0
source /etc/util.sh
source /etc/util.js.sh
source /etc/core.js.sh
source /etc/demo.js.sh

awaitWorld

`.trim();

export type ProfileKey = keyof typeof import("./profiles");
