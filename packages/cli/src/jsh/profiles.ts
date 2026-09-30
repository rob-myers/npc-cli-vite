export const default_profile = `
# default profile
source /etc/{util,alias}.sh
source /etc/{util,core,demo,demo_mcp,demo_prolog,debug,decor,pred,term}.js.sh
awaitWorld
predicates
terms

`.trim();

export const empty_profile = `
# empty profile: maybe source something?
# source /etc/{util,alias}.sh
# source /etc/{util,core,demo,demo_mcp,demo_prolog,debug,decor,pred,term}.js.sh

`.trim();

export type ProfileKey = keyof typeof import("./profiles");
