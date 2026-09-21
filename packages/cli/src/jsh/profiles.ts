export const default_profile = `
# default profile
source /etc/{util,alias}.sh
source /etc/{util,core,demo,debug,pred,route}.js.sh
awaitWorld
predicates
route_init

`.trim();

export const empty_profile = `
# empty profile: maybe source something?
# source /etc/{util,alias}.sh
# source /etc/{util,core,demo,debug,pred}.js.sh

`.trim();

export type ProfileKey = keyof typeof import("./profiles");
