export const default_profile = `
# default profile
source /etc/util.sh
source /etc/{util,core,demo,pred}.js.sh

awaitWorld
predicates

`.trim();

export const empty_profile = `
# empty profile: maybe source something?
# source /etc/util.sh
# source /etc/{util,core,demo,pred}.js.sh

`.trim();

export type ProfileKey = keyof typeof import("./profiles");
