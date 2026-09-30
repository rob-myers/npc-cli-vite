% Loaded once per worker, before anything else. Helpers are prefixed `pl_`.

:- use_module(library(json)).
:- use_module(library(apply)).
:- use_module(library(lists)).

:- dynamic node/3.

node(Name, Body) :- node(Name, Body, _).

%% Body with its variables bound to their names, so distinct roles never unify
node_named(Name, Body) :- node(Name, Body, Vs), maplist(pl_bind_name, Vs).

%% Term -> JSON (see `Term` in types.ts). Vs names variables; the rest become `_G0`, `_G1`, ...
pl_json(T, Vs, J) :-
    copy_term(T-Vs, T2-Vs2),
    maplist(pl_bind_name, Vs2),
    term_variables(T2, Rest),
    pl_name_rest(Rest, 0),
    pl_to_json(T2, J).

pl_bind_name(N=V) :- ( var(V) -> V = '$VAR'(N) ; true ).

pl_name_rest([], _).
pl_name_rest([V|Vs], I) :- format(atom(N), "_G~d", [I]), V = '$VAR'(N), I1 is I + 1, pl_name_rest(Vs, I1).

pl_to_json(X, X) :- number(X), !.
pl_to_json('$VAR'(N), _{v:S}) :- !, format(string(S), "~w", [N]).
pl_to_json(X, S) :- atom(X), !, atom_string(X, S).
pl_to_json(X, _{s:X}) :- string(X), !.
pl_to_json(X, J) :- is_list(X), !, maplist(pl_to_json, X, J).
pl_to_json(X, _{f:F, args:As}) :-
    compound_name_arguments(X, N, Args),
    atom_string(N, F),
    maplist(pl_to_json, Args, As).

pl_write_json(J, S) :- with_output_to(string(S), json_write_dict(current_output, J, [width(0)])).

%% JSON text -> Term, with its variables' names
pl_json_term(Text, T, Vs) :-
    atom_json_dict(Text, J, [value_string_as(string)]),
    pl_from_json(J, T, [], Vs0),
    reverse(Vs0, Vs).

pl_from_json(J, J, Vs, Vs) :- number(J), !.
pl_from_json(J, A, Vs, Vs) :- string(J), !, atom_string(A, J).
pl_from_json(J, T, Vs0, Vs) :- is_list(J), !, pl_from_json_list(J, T, Vs0, Vs).
pl_from_json(J, V, Vs0, Vs) :-
    get_dict(v, J, S), !,
    atom_string(N, S),
    ( memberchk(N=V0, Vs0) -> V = V0, Vs = Vs0 ; Vs = [N=V|Vs0] ).
pl_from_json(J, S, Vs, Vs) :- get_dict(s, J, S), !.
pl_from_json(J, T, Vs0, Vs) :-
    get_dict(f, J, F), get_dict(args, J, As),
    atom_string(N, F),
    pl_from_json_list(As, Args, Vs0, Vs),
    compound_name_arguments(T, N, Args).

pl_from_json_list([], [], Vs, Vs).
pl_from_json_list([J|Js], [T|Ts], Vs0, Vs) :- pl_from_json(J, T, Vs0, Vs1), pl_from_json_list(Js, Ts, Vs1, Vs).

%% Ops, each giving a JSON string S

pl_answer(Goal, S) :-
    term_string(G, Goal, [variable_names(Vs)]),
    call(user:G),
    copy_term(Vs, Vs2),
    maplist(pl_bind_name, Vs2),
    term_variables(Vs2, Rest),
    pl_name_rest(Rest, 0),
    findall(K=J, (member(K=V, Vs2), V \== '$VAR'(K), \+ sub_atom(K, 0, _, _, '_'), pl_to_json(V, J)), Pairs),
    pl_write_json(json(Pairs), S). % keeps the goal's order, which a dict would sort

pl_parse(Text, S) :-
    term_string(T, Text, [variable_names(Vs)]),
    pl_json(T, Vs, J),
    pl_write_json(J, S).

pl_write(Json, S) :-
    pl_json_term(Json, T, Vs),
    with_output_to(string(S), write_term(T, [quoted(true), variable_names(Vs), spacing(next_argument)])).

pl_nodes(S) :-
    findall(_{name:NS, body:J}, (node(N, T, Vs), atom_string(N, NS), pl_json(T, Vs, J)), L),
    pl_write_json(L, S).

pl_set_node(Name, Json) :-
    pl_json_term(Json, T, Vs),
    retractall(node(Name, _, _)),
    assertz(node(Name, T, Vs)).

pl_remove_node(Name) :- retractall(node(Name, _, _)).

pl_reset_nodes(Json) :-
    retractall(node(_, _, _)),
    atom_json_dict(Json, L, [value_string_as(string)]),
    forall(member(D, L), (
        atom_string(N, D.name),
        pl_from_json(D.body, T, [], Vs0),
        reverse(Vs0, Vs),
        assertz(node(N, T, Vs))
    )).
