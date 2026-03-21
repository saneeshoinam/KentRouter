import KentRouter from "./router.js"
export default class TypedKentRouter extends KentRouter {
    constructor() {
        super()
        this.__typing_support = true
    }

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

    __validate_types(ev, route) {
        const { type_check } = route
        const { params, query, hash } = ev // no support for hash added yet
        // Params check
        for (let param_name in type_check.params) {
            if (!params[param_name]) continue
            const constraints = type_check.params[param_name]
            if (!this.#check_type(param_name, constraints, params)) return false
        }

        // Query check
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
        if (changeQuery) this.updateQuery(o)
        // Hash check yet to implement

        return true
    }

    __evaluate_type_score(route) {
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