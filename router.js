export default class KentRouter {
    routes = []
    #route_id = 0

    constructor() {
        addEventListener("popstate", () => {
            const url = this.#normalize_url(location.href)
            this.#newRoute(url, true)
        })
    }

    // +--------------------+
    // | URL Change Methods |
    // +--------------------+

    init() {
        const url = this.#normalize_url(location.href) // router accept paths with search and hash, that should be retrieved using location.hash/search after pushState in router
        const destination = url.path + url.query + url.hash

        if (this.#current_path == destination) return
        this.#newRoute(url, true)
    }

    set(path) {
        const url = this.#normalize_url(path) // router accept paths with search and hash, that should be retrieved using location.hash/search after pushState in router
        const destination = url.path + url.query + url.hash

        if (this.#current_path == destination) return
        this.#newRoute(url)
    }

    push({ path, query, hash } = {}) {
        const url = new URL(window.location.href);

        if (path) {
            url.pathname = path;
        }

        if (query) {
            const params = new URLSearchParams(url.search);

            for (const key in query) {
                const value = query[key];

                if (value === null || value === undefined) {
                    params.delete(key); // remove param
                } else {
                    params.set(key, value);
                }
            }

            url.search = params.toString();
        }

        if (hash !== undefined) {
            url.hash = hash ? `#${hash}` : "";
        }

        this.set(
            url.pathname +
            (url.search ? url.search : "") +
            (url.hash || "")
        );
    }

    redirect(path, dest) {
        const url = this.#normalize_url(path)
        const { exp, paramNames } = this.#path_exp(url.path)
        const score = this.#score(url.path)

        const route = {
            redirect: true, // redirect route mode
            path: url.path,
            parts: url.parts, // for matching inner routes
            length: url.parts.length,
            capture_all: /.*\*$/.test(url.parts[url.parts.length - 1]),
            exp,
            score,
            paramNames,
            routes: [],
            init: (ctx) => {
                const destination = typeof dest == "function" ? this.#normalize_url(dest(ctx)) : this.#normalize_url(dest.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
                    return ctx.params[name] ?? ""
                }))
                const newPath = destination.path + destination.query + destination.hash
                if (newPath != ctx.origin) this.set(newPath)
                else {
                    // remove infinite loop causing redirects
                    throw new Error("Infinite Redirect Route")
                }
            }
        }

        this.routes = this.#rankRoute(route, this.routes)
    }

    // remove_route(path) {
    //     if (this.#active_route && this.#active_route.path == path) this.#active_route = null
    //     const remRoutes = [] // remaining routes
    //     for (let route of this.routes) {
    //         if (route.path != path) remRoutes.push(route)
    //     }
    //     this.routes = remRoutes
    // }

    listen({
        capture,
        init,
        enter,
        update,
        exit,
        params,
        query,
        routes
    } = {}) {
        this.routes = this.#rankRoute(this.#makeRoute({
            capture,
            init,
            enter,
            update,
            exit,
            params,
            query,
            routes
        }), this.routes)
    }

    #makeRoute({
        capture,
        init,
        enter,
        update,
        exit,
        params,
        query,
        routes
    } = {}) {
        const url = this.#normalize_url(capture)
        const { exp, paramNames } = this.#path_exp(url.path)
        const score = this.#score(url.path)

        let innerRoutes = []
        if (routes) {
            for (let o of routes) {
                const route = this.#makeRoute(o)
                innerRoutes = this.#rankRoute(route, innerRoutes)
            }
        }

        const route = {
            path: url.path,
            parts: url.parts, // for matching inner routes
            length: url.parts.length,
            capture_all: /.*\*$/.test(url.parts[url.parts.length - 1]),
            routes: innerRoutes, // inner routes
            id: ++this.#route_id,
            score,
            exp,
            init: init ?? function () { },
            enter: enter ?? function () { },
            update: update ?? function () { },
            exit: exit ?? function () { },
            // For type_checks
            type_check: {
                params: params ?? {},
                query: query ?? {}
            },
            // Flags
            flags: {
                active: false,
                initCalled: false,
            },
            // Helper methods
            getPart(url, start) {
                const { parts } = url
                if (this.length + start <= parts.length) {
                    let path = ""
                    for (let i = start; i < this.length; i++) path += '/' + parts[i]
                    return path
                }

                return null
            },
            // track param changes
            lastParams: {},
            paramNames,
        }

        route.score += this.#typeScore(route)


        return route
    }

    #rankRoute(newRoute, routesObject) {
        const newScore = newRoute.score
        const newRoutes = []
        let inserted = false

        for (const route of routesObject) {
            if (!inserted && newScore > route.score) {
                newRoutes.push(newRoute)
                inserted = true
            }
            newRoutes.push(route)
        }

        if (!inserted) newRoutes.push(newRoute)

        return newRoutes
    }

    // +--------------------+
    // | TYPE CHECKS        |
    // +--------------------+

    // Do range checks (num is between min & max)
    #num_range(o, value) {
        const { min, max } = o
        const min_inclusive = o.min_inclusive ?? true
        const max_inclusive = o.max_inclusive ?? true

        if (min == undefined || max == undefined) return false

        if (min_inclusive) {
            if (!(min <= value)) return false
        }
        else {
            if (!(min < value)) return false
        }

        if (max_inclusive) {
            if (!(max >= value)) return false
        }
        else {
            if (!(max > value)) return false
        }
        return true
    }

    // Do allow, deny checks
    #validate_number(constraints, value) {
        if (constraints.denied) for (let denied_value of constraints.denied) {
            const type = typeof denied_value
            switch (type) {
                case "number":
                    if (denied_value == value) return false
                    break
                case "object":
                    if (this.#num_range(denied_value, value)) return false
            }
        }
        // allow
        if (constraints.allowed) for (let allowed_value of constraints.allowed) {
            const type = typeof allowed_value
            switch (type) {
                case "number":
                    if (allowed_value == value) return true
                    break
                case "object":
                    if (!this.#num_range(allowed_value, value)) return false
            }
        }
        if (constraints.allowed) return false
        return true
    }

    // ;b my naming skills is sh*t
    #check_type(
        name,
        constraints,
        target
    ) {
        // for (let param in type_constraints) {
        //     if (!target[param]) continue
        // const constraints = type_constraints[param]
        let value = target[name]
        switch (constraints.type) {
            case "enum":
                let enum_valid_flag = false
                if (constraints.case_insensitive) {
                    value = value.toLowerCase()
                    for (let allowed_value of constraints.values) if (allowed_value.toLowerCase() == value) {
                        enum_valid_flag = true
                        break
                    }
                }
                else for (let allowed_value of constraints.values) if (allowed_value == value) {
                    enum_valid_flag = true
                    break
                }
                if (!enum_valid_flag) return false
                break
            case "slug":
                if (!/^[a-z\-0-9]+$/.test(value)) return false
                break
            case "number":
                if (!/^-?\d+(\.\d+)?$/.test(value)) return false
                value = parseFloat(value)
                target[name] = value
                return this.#validate_number(constraints, value) // for allowed and denied values
            case "int":
                if (!/^-?\d+$/.test(value)) return false
                value = parseInt(value)
                target[name] = value
                return this.#validate_number(constraints, value)
            case "uuid":
                if (!/^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return false
                break
            case "string":
                if (constraints.match && !constraints.match.test(value)) return false
        }
        // }

        return true
    }

    #checkParams(params /* ctx */, route) {
        if (!route.type_check) return true
        const { type_check } = route
        // Params check
        for (let param_name in type_check.params) {
            if (!params[param_name]) continue
            const constraints = type_check.params[param_name]
            if (!this.#check_type(param_name, constraints, params)) return false
        }



        return true
    }

    #checkParametrics(paramatrics, url, route) {
        const { type_check } = route
        const { query, hash } = paramatrics // no support for hash added yet
        // // Query check
        let changeQuery = false
        let o = {}
        for (let query_name in type_check.query) {

            const constraints = type_check.query[query_name]

            let { fallback, transform } = constraints // fallback when type check has error
            let def = constraints.default // default is set when field is required but not present

            const initial_query_value = query[query_name]

            if (query[query_name] === undefined) {
                if (constraints.required) {
                    // if default is presents
                    if (def != undefined) {
                        query[query_name] = transform != undefined ? transform(def) : def
                        if (initial_query_value != query[query_name]) {
                            o[query_name] = query[query_name]
                            if (!changeQuery) changeQuery = true
                        }
                        continue // assume default value of the right datatype
                    }
                    else return false
                }
                else continue
            }

            if (this.#check_type(query_name, constraints, query)) {
                if (transform != undefined) {
                    query[query_name] = transform(query[query_name])
                }
            }
            else {
                if (fallback != undefined) {
                    query[query_name] = transform != undefined ? transform(fallback) : fallback
                }
                else return false
            }

            if (initial_query_value != query[query_name]) {
                o[query_name] = query[query_name]
                if (!changeQuery) changeQuery = true
            }
        }
        if (changeQuery) {
            const params = new URLSearchParams(url.query);

            // merge updates
            for (const key in o) {
                const value = o[key];

                if (value === undefined || value === null) {
                    params.delete(key); // remove param
                } else {
                    params.set(key, value); // add/update param
                }
            }

            // get updated query string
            url.query = "?" + params.toString();
        }
        // Hash check yet to implement
        return true
    }

    // +-----------------+
    // | ROUTING PROCESS |
    // +-----------------+

    #process_id = 0
    #prevProcess
    #process = {}
    #current_path

    #newProcess(chain, url, paramatrics, callReplaceState) {
        const controller = new AbortController()
        const signal = controller.signal

        this.#process = {
            id: ++this.#process_id,
            url,
            destination: url.path + url.query + url.hash,
            chain,
            controller,
            signal,
            ongoing: true,
            callReplaceState,
            paramatrics
        }
    }


    #active_chain = []

    #newRoute(
        url,
        callReplaceState = false
    ) {
        if (this.#process.ongoing) this.#endRoute()

        const { chain, paramatrics } = this.#routes(url) // now returns [{ route, params }]

        const leaf = chain[chain.length - 1]?.route

        if (leaf?.redirect === true) {
            const ctx = {}
            this.#reflectParametrics(ctx, url, leaf)
            ctx.origin = url.path + url.query + url.hash
            ctx.params = chain[chain.length - 1].params
            leaf.init(ctx)
            return
        }

        this.#newProcess(chain, url, paramatrics, callReplaceState)

        this.#startRoute()
    }

    #reflectParametrics(paramatrics, url) {
        // search params
        paramatrics.query = {}
        const searchParams = new URLSearchParams(url.query)
        for (let query of searchParams.keys()) {
            paramatrics.query[query] = searchParams.get(query)
        }

        // hash
        paramatrics.hash = url.hash.length == 0 ? undefined : url.hash.substring(1)
    }

    #reflectParams(params, path, route) {
        const matches = path.match(route.exp)
        for (let i = 0; i < route.paramNames.length; i++) {
            params[route.paramNames[i]] = matches[i + 1]
        }
    }

    #ctx(process, depth, paramatrics, chain) {
        const { params, route } = chain[depth]
        return {
            depth,
            chain,
            route,
            isLeaf: depth === chain.length - 1,
            nextMatch: chain[depth + 1] || null,
            signal: process.controller.signal,
            changes: {
                params: {},
                query: {}
            },
            params,
            state: route.state,
            controller: process.controller,
            redirect: (path) => {
                this.set(path)
            },
            query: paramatrics?.query ?? {},
            hash: paramatrics?.hash
        }
    }

    #reflectParamsChanges(ctx, route) {
        // Determine if any params, query or hash change
        const { lastParams, paramNames } = route
        const changes = ctx.changes

        for (let param of paramNames) {
            if (ctx.params[param] != lastParams[param]) {
                changes.params[param] = "updated"
                lastParams[param] = ctx.params[param]
            }
        }
    }

    #record = {
        query: {},
        hash: undefined,
    }

    #reflectParamatricsChanges(paramatrics) {
        const { query: prevQuery, hash: prevHash } = this.#record

        const nextQuery = paramatrics.query || {}

        const changes = {
            query: {}
        }

        // Add / Update
        for (let key in nextQuery) {
            if (prevQuery[key] === undefined) {
                changes.query[key] = "added"
            } else if (prevQuery[key] !== nextQuery[key]) {
                changes.query[key] = "updated"
            }
        }

        // Removed
        for (let key in prevQuery) {
            if (nextQuery[key] === undefined) {
                changes.query[key] = "removed"
            }
        }

        // Hash changes
        if (prevHash !== nextQuery.hash) {
            if (prevHash === undefined) {
                changes.hash = "added"
            } else if (nextQuery.hash === undefined) {
                changes.hash = "removed"
            } else {
                changes.hash = "updated"
            }
        }

        return changes
    }

    async #startRoute() {
        const process = this.#process
        const { id, chain, paramatrics } = process

        const prev = this.#active_chain || []
        const next = chain

        const paramatricsChanges = this.#reflectParamatricsChanges(paramatrics)
        const state = {} // every route process shares this state object

        try {
            let i = 0
            while (
                i < prev.length &&
                i < next.length &&
                prev[i].route === next[i].route
            ) {
                i++
            }

            const commonLength = i

            for (let j = prev.length - 1; j >= commonLength; j--) {
                const { route } = prev[j]
                const ctx = this.#ctx(process, j, paramatrics, this.#prevProcess.chain)
                ctx.state = state
                this.#reflectParamsChanges(ctx, route)
                ctx.changes = { params: ctx.changes.params, ...paramatricsChanges }

                const res = await route.exit(ctx, route.state)
                if (this.#process_id != id) return
                if (res === false) return

                route.flags.active = false

                if (typeof res === "string") {
                    this.set(res)
                    return
                }
            }

            for (let j = commonLength; j < next.length; j++) {
                const { route } = next[j]

                if (route.flags.initCalled === false) {
                    const ctx = this.#ctx(process, j, paramatrics, process.chain)
                    ctx.state = state
                    this.#reflectParamsChanges(ctx, route)
                    ctx.changes = { params: ctx.changes.params, ...paramatricsChanges }

                    const res = await route.init(ctx, route.state)
                    if (this.#process_id != id) return
                    if (res === false) return

                    route.flags.initCalled = true

                    if (typeof res === "string") {
                        this.set(res)
                        return
                    }
                }
            }

            for (let j = 0; j < commonLength; j++) {
                const { route } = next[j]
                const ctx = this.#ctx(process, j, paramatrics, process.chain)
                ctx.state = state
                this.#reflectParamsChanges(ctx, route)
                ctx.changes = { params: ctx.changes.params, ...paramatricsChanges }

                const res = await route.update(ctx, route.state)
                if (this.#process_id != id) return
                if (res === false) return

                if (typeof res === "string") {
                    this.set(res)
                    return
                }
            }

            for (let j = commonLength; j < next.length; j++) {
                const { route } = next[j]
                const ctx = this.#ctx(process, j, paramatrics, process.chain)
                ctx.state = state
                this.#reflectParamsChanges(ctx, route)
                ctx.changes = { params: ctx.changes.params, ...paramatricsChanges }

                const res = await route.enter(ctx, route.state)
                if (this.#process_id != id) return
                if (res === false) return

                if (typeof res === "string") {
                    this.set(res)
                    return
                }

                route.flags.active = true
            }

            this.#active_chain = next

            if (process.callReplaceState) {
                history.replaceState({}, "", process.destination)
            } else {
                history.pushState({}, "", process.destination)
            }

            this.#current_path = process.destination

        } catch (err) {
            if (err.name === "AbortError") return
            throw err
        } finally {
            if (this.#process_id == id) {
                process.ongoing = false
                this.#prevProcess = this.#process
                this.#record = paramatrics
            }
        }
    }

    #endRoute() {
        if (this.#process.ongoing) {
            this.#process.ongoing = false
            this.#process.controller.abort()
        }
    }

    #routes(url) {
        const { parts } = url
        const l = parts.length
        let start = 0

        function getPart(start, next) {
            const k = start + next
            if (k > l) {
                return null
            }
            let path = ""
            for (let i = start; i < k; i++) path += "/" + parts[i]
            return path
        }

        const paramatrics = {}
        this.#reflectParametrics(paramatrics, url)

        let routes = this.routes
        const routingQueue = []
        const err = { chain: [{ route: this.#notFoundRoute, params: {} }], paramatrics }

        // console.log(parts, getPart(start, 2))

        outerloop:
        while (true) {
            for (let route of routes) {
                const n = route.capture_all ? l - start : route.length
                const path = getPart(start, n)
                if (path == null) continue

                if (route.exp.test(path)) {
                    const params = {}
                    this.#reflectParams(params, path, route)
                    if (route.type_check) {
                        const good_type = this.#checkParams(params, route)
                        if (!good_type) continue
                        // check params here
                        const good_paramatrics = this.#checkParametrics(paramatrics, url, route)
                        if (!good_paramatrics) continue
                    }
                    start += n
                    routingQueue.push({ route, params })
                    const nextRoutes = route.routes
                    if (start == l) return { paramatrics, chain: routingQueue }
                    else {
                        if (nextRoutes.length == 0) {
                            return err
                        }
                        else {
                            routes = nextRoutes
                            continue outerloop
                        }
                    }
                }
            }
            return err
        }
    }

    // +-----------------+
    // | NOT FOUND ROUTE |
    // +-----------------+

    #notFoundRoute = {
        score: -1,
        init() { },
        enter() { },
        exit() { },
        update() { },
        id: ++this.#route_id,
        path: "*",
        normalized_exp: /.*/,
        paramNames: [],
        lastQuery: {},
        lastParams: {},
        flags: {
            active: false,
            initCalled: false // true suggest that current open path matches this route and is active
        },
        hash: undefined // after #...
    }

    notFound(
        {
            init, enter, exit
        } = {}
    ) {
        this.#notFoundRoute.init = init ?? (() => { })
        this.#notFoundRoute.enter = enter ?? (() => { })
        this.#notFoundRoute.exit = exit ?? (() => { })
    }

    // +-----------------+
    // | UTILITY HELPERS |
    // +-----------------+

    #normalize_url(
        url // full url or just path
    ) {
        if (!url) return {
            path: "/",
            query: "",
            hash: "",
            parts: [""]
        }

        const baseURL = new URL(url, location.origin)
        let normal = baseURL.pathname // remove https://...
        normal = decodeURIComponent(normal)

        normal = normal.replace(/\/+/g, "/") // duplicate "/"
        if (normal.length > 1 && normal[normal.length - 1] == "/") normal = normal.slice(0, -1) // remove trailing "/"
        const parts = normal.split('/').filter(Boolean)
        return {
            path: normal,
            parts: parts.length == 0 ? [""] : parts,
            query: baseURL.search,
            hash: baseURL.hash
        }
    }

    #path_exp(path) {
        const paramNames = []

        path = path.replace(/[.+?^${}()|[\]\\]/g, "\\$&") // makes symbols like +, ?, * work as character and not as selection codes
        const pattern = /:([a-zA-Z0-9_]+)\*|:([a-zA-Z0-9_]+)|\*/g;

        path = path.replace(pattern, (_, splat, param) => {
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

        const exp = new RegExp("^" + path + "$")

        return { exp, paramNames }
    }

    #score(path) {
        /* 

        +--------------+-------+
        | pattern      | score |
        | static-path  |     4 |
        | :query       |     3 |
        | :query*      |     2 |
        | *            |     1 |
        +--------------+-------+
        
        Note: `:query[anycharacter not a-zA-Z0-9_ 
               between two queries will contribute 4 points]:anotherquery`
        
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

    #typeScore(route) {
        let score = 0
        /*
        Type Score Table
            enum    4
            uuid    3
            int     2.5
            number  2
            slug    1.5
            string  1
        */
        const { type_check } = route
        for (let param of route.paramNames) {
            switch (type_check.params[param]?.type) {
                case "enum":
                    score += 4
                    break

                case "uuid":
                    score += 3
                    break

                case "int":
                    score += 2.5
                    break

                case "number":
                    score += 2
                    break

                case "slug":
                    score += 1.5
                    break

                case "string":
                    score += 1
                    break
            }
        }
        return score
    }
}