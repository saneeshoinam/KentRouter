/*
    KentRouter v1.0
*/

export default class KentRouter {
    #queue = []
    #processing_queue = false
    #fallback_handler = {}
    #active_route = null // place the active route here for exit event
    #active_normal_path = null // the active normal path (normal -> pathname) + query + hash
    __typing_support = false
    #nf_route_active = false // not found route active

    constructor() {
        this.routes = []
        addEventListener("popstate", () => {
            this.#route_handler(this.#get_normal_path(location.pathname).path, () => { })
        })
        // addEventListener("pageshow", (e) => {
        //     console.log("PageShow", location.pathname, e.persisted)
        //     if (e.persisted) {
        //         console.log(this.routes)
        //         this.#route_handler(this.#get_normal_path(location.pathname).path)
        //     }
        // })
    }

    // method available ev param of update of listen setter
    #watch(
        p, // params | hash | query
        e
    ) {
        const target = this[p]
        const changed = this.changed[p]
        switch (typeof target) {
            case "object":
                for (let a in changed) {
                    const m = changed[a] // change mode "added", "removed", "upadated"
                    if (m) e[a]?.(target[a], m)
                }
                break
            default:
                if (changed) {
                    e(target, changed)
                }
        }
    }

    // normalises a path, removes ?query and #hash
    #get_normal_path(path) {
        if (!path) return {
            path: "/",
            query: "",
            hash: ""
        }

        const url = new URL(path, location.origin)
        let normal = url.pathname // remove https://...
        normal = decodeURIComponent(normal)

        normal = normal.replace(/\/+/g, "/") // duplicate "/"
        if (normal.length > 1 && normal[normal.length - 1] == "/") normal = normal.slice(0, -1) // remove trailing "/"

        return {
            path: normal,
            query: url.search,
            hash: url.hash
        }
    }

    #get_path_score(path) {
        /*
         * 
         * Score Table
         * static-path 4
         * :query 3
         * :query* 2
         * * 1
         * 
         * Note
         * :query[anycharacter not a-zA-Z0-9_ between two queries will contribute 4 points]:anotherquery
         */

        if (!path) return 0

        const segments = path.split('/').filter(Boolean)
        let score = 0

        for (const segment of segments) {

            // Full wildcard segment
            if (segment === '*') {
                score += 1
                break // Note for dev: after wildcard nothing else is captured
                // /*/appSettings is equivalent as /*
            }

            let i = 0

            while (i < segment.length) {

                // Param
                if (segment[i] === ':') {
                    let j = i + 1

                    // Match [a-zA-Z0-9_]
                    while (j < segment.length && /[a-zA-Z0-9_]/.test(segment[j])) {
                        j++
                    }

                    // Check if param*
                    if (segment[j] === '*') {
                        score += 2
                        j++
                    } else {
                        score += 3
                    }

                    i = j
                } else {
                    // Static character sequence
                    let j = i
                    while (j < segment.length && segment[j] !== ':') {
                        j++
                    }

                    score += 4
                    i = j
                }
            }
        }

        return score
    }

    #get_normalized_exp(
        normal // normalised path
    ) {

        const paramNames = []

        normal = normal.replace(/[.+?^${}()|[\]\\]/g, "\\$&") // makes symbols like +, ?, * work as character and not as selection codes
        const pattern = /:([a-zA-Z0-9_]+)\*|:([a-zA-Z0-9_]+)|\*/g;

        normal = normal.replace(pattern, (_, splat, param) => {
            if (splat) { // for :query* selection
                paramNames.push(splat);
                return "(.+)";
            }

            if (param) { // for :query selection
                paramNames.push(param);
                return "([^/]+)";
            }

            // wildcard *
            paramNames.push("*");
            return "(.*)";
        });

        const normalized_exp = new RegExp("^" + normal + "$")

        return { normalized_exp, paramNames }
    }

    listen(
        {
            path, enter, exit, update,
            params, query, hash // need extended router with types to use
        } = {
            },
        updateHistory = true // doesn't change history state
        // Mainly useful for redirects where you don't want to keep records
    ) {
        // Normalize the path input
        const normal = this.#get_normal_path(path).path
        const { normalized_exp, paramNames } = this.#get_normalized_exp(normal)
        let score = this.#get_path_score(normal)
        const o = {
            normalized_exp,
            updateHistory,
            path: normal,
            paramNames,
            enter: enter ?? (() => { }),
            update: update ?? (() => { }),
            exit: exit ?? (() => { }),
            score,
            lastQuery: {},
            lastParams: {},
            routeState: {
                initiated: false // true suggest that current open path matches this route and is active
            },
            hash: undefined // after #...
        }
        if (this.__typing_support) o.type_check = { params: params ?? {}, query: query ?? {}, hash: hash ?? {} }
        this.routes.push(o)
        if (this.__typing_support) o.score += this.__evaluate_type_score(o)

        this.routes.sort((a, b) => b.score - a.score)
    }


    // handle window popStates
    #route_handler(normal, historyResolver) {
        for (let route of this.routes) {
            if (route.normalized_exp.test(normal)) {
                if (this.#nf_route_active) {
                    this.#nf_route_active = false
                    this.#fallback_handler?.exit()
                }

                historyResolver(route.updateHistory)

                // Event Object to be passed
                const hash = location.hash
                const ev = {
                    params: {},
                    query: {},
                    hash: hash.length == 0 ? undefined : hash.substring(1),
                    normalized_exp: route.normalized_exp,
                    path: route.path
                }

                // Get search params
                const searchParams = new URLSearchParams(location.search)

                for (let query of searchParams.keys()) {
                    ev.query[query] = searchParams.get(query)
                }

                // Get params
                const matches = normal.match(route.normalized_exp)
                for (let i = 0; i < route.paramNames.length; i++) {
                    ev.params[route.paramNames[i]] = matches[i + 1]
                }

                if (route.routeState.initiated) {
                    // Typing support here
                    if (this.__typing_support) {
                        if (this.__validate_types(ev, route)) {
                            this.#updateRoute(ev, route)
                            return
                        }
                        else continue
                    }
                    this.#updateRoute(ev, route)
                    return
                }

                // Typing support here
                if (this.__typing_support) {
                    if (this.__validate_types(ev, route)) {
                        this.#initRoute(ev, route)
                        return
                    }
                    else continue
                }
                this.#initRoute(ev, route)
                return
            }
        }

        // No suitable route
        this.#exit_active_route()
        this.#active_route = null
        historyResolver(true)
        if (!this.#nf_route_active) {
            this.#nf_route_active = true
            this.#fallback_handler?.enter()
        }

    }

    #updateRoute(ev, route) {
        // Determine if any params, query or hash change
        const { lastParams, lastQuery, hash } = route
        const changed = {
            params: {},
            query: {},
            // hash: 
        }

        for (let param in lastParams) {
            if (ev.params[param] != lastParams[param]) {
                changed.params[param] = "updated"
                lastParams[param] = ev.params[param]
            }
        }

        for (let query in ev.query) {
            if (lastQuery[query] == undefined) {
                changed.query[query] = "added"
                lastQuery[query] = ev.query[query]
            }
            else if (lastQuery[query] != ev.query[query]) {
                changed.query[query] = "updated"
                lastQuery[query] = ev.query[query]
            }
        }
        // Delete unwanted query
        for (let query in lastQuery) {
            if (lastQuery[query] != undefined && ev.query[query] == undefined) {
                changed.query[query] = "removed"
                lastQuery[query] = undefined
            }
        }

        // if (hash != ev.hash) {
        //     changed.hash = true
        //     route.hash = ev.hash
        // }
        if (hash != undefined && ev.hash == undefined) {
            changed.hash = "removed"
            route.hash = undefined
        }
        else if (hash == undefined && ev.hash != undefined) {
            changed.hash = "added"
            route.hash = ev.hash
        }
        else if (ev.hash != hash) {
            changed.hash = "updated"
            route.hash = ev.hash
        }

        ev.changed = changed
        ev.watch = this.#watch
        route.update(ev)
    }

    #initRoute(ev, route) {
        route.routeState.initiated = true
        route.lastParams = { ...ev.params }
        route.lastQuery = { ...ev.query }
        route.hash = ev.hash

        // Special update function for new entry
        ev.update = () => {
            // generate changed object
            const changed = {
                params: {},
                query: {},
                // hash: ev.hash != undefined ? true : false
            }
            if (ev.hash != undefined) changed.hash = "added"
            for (let param in ev.params) changed.params[param] = "updated"
            for (let query in ev.query) changed.query[query] = "added"
            route.update(
                {
                    changed,
                    params: ev.params,
                    query: ev.query,
                    hash: ev.hash,
                    watch: this.#watch
                }
            )
        }

        this.#exit_active_route()
        this.#active_route = route
        route.enter(ev)
    }

    notFound(
        {
            enter, exit
        } = {}
    ) {
        this.#fallback_handler = {
            enter: enter ?? (() => { }),
            exit: exit ?? (() => { })
        }
    }

    #exit_active_route() {
        if (this.#active_route) {
            const r = this.#active_route
            r.routeState.initiated = false
            r.exit({
                params: r.lastParams,
                query: r.lastQuery,
                hash: r.hash
            })
            // console.log("Removed active route", this.#active_route.path)
        }
    }

    set(path) {
        // const url = new URL(path, location.origin)
        const normal = this.#get_normal_path(path) // router accept paths with search and hash, that should be retrieved using location.hash/search after pushState in router
        const active_path = normal.path + normal.query + normal.hash

        if (this.#active_normal_path == active_path) return
        // Note: Implement a queue to avoid collision
        this.#queue.push(() => {

            this.#active_normal_path = active_path
            this.#route_handler(normal.path, (updateHistory) => {
                if (updateHistory) {
                    history.pushState({
                        from: this.#active_normal_path
                    }, "", active_path)
                }
            })
            this.#process_queue()
        })

        if (!this.#processing_queue) this.#process_queue()
    }

    #process_queue() {
        if (this.#queue.length == 0) {
            this.#processing_queue = false
            return
        }
        if (!this.#processing_queue && this.#queue.length > 0) this.#processing_queue = true

        const fn = this.#queue.shift()
        fn()
    }

    // Call corresponding entry listener that matches current page
    init() {
        const normal = this.#get_normal_path(location.pathname)
        const active_path = normal.path + location.search + location.hash

        this.#queue.push(() => {
            this.#active_normal_path = active_path
            this.#route_handler(normal.path, (updateHistory) => {
                if (updateHistory) {
                    history.replaceState({ from: "" }, "", active_path) // to normalize the path and also a way to properly record the init page on stack as some browsers have some issues on navigation
                }
            })
            this.#process_queue()
        })

        if (!this.#processing_queue) this.#process_queue()
        // this.set(location.pathname)
    }

    remove_route(path) {
        if (this.#active_route && this.#active_route.path == path) this.#active_route = null
        const remRoutes = []
        for (let route of this.routes) {
            if (route.path != path) remRoutes.push(route)
        }
        this.routes = remRoutes
    }

    redirect(path, dest, noRefresh = false, type_constraints) {
        const type = typeof dest
        const o = {
            path,

            enter: (e) => {
                let normal = ""
                if (type == "string") {
                    normal = this.#get_normal_path(dest.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
                        return e.params[name] ?? ""
                    }))
                } else if (type == "function") {
                    normal = this.#get_normal_path(dest(e))
                }

                const active_path = normal.path + normal.query + normal.hash
                if (active_path != this.#active_normal_path && !e.normalized_exp.test(normal.path)) {
                    if (noRefresh) {
                        this.set(active_path)
                    } else {
                        this.#exit_active_route()
                        location.href = active_path
                    }
                } else {
                    // remove routing: causes infinite loop error
                    this.remove_route(e.path)
                }
            }
        }
        if (this.__typing_support) {
            o.params = type_constraints.params ?? {}
            o.query = type_constraints.query ?? {}
            o.hash = type_constraints.hash ?? {}
        }
        this.listen(
            o,
            true
        )
    }

    // Silently update query or what you call search
    updateQuery(o) {
        const normal = this.#get_normal_path(location.href)
        const searchParams = new URLSearchParams(normal.query)
        const query = {}
        for (let key of searchParams.keys()) query[key] = searchParams.get(key)
        for (let key in o) query[key] = o[key]
        this.#active_normal_path = normal.path + "?" + new URLSearchParams(query).toString() + normal.hash
        history.replaceState(history.state, "", this.#active_normal_path)
    }
}