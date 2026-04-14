# **Not audited to match the latest version**
# Usage guide for KentRouter

There are two router modes:
1. Simple router
2. Router build with type checks

We will see typed routers later on in the docs.
## Simple KentRouter
### Start template
```js
import KentRouter from "./router.js"
const router = new KentRouter()
// listeners here
// ...
router.init()
```
### Updating url without page refresh
```js
router.set("<url")
// Example
router.set("/about?lang=en")
router.set("https://example.com/test") // must have same origin
```
### Adding a listener
```js
router.listen(
    {
        path: "<capture-pattern>",
        enter(ev) {
            // Calls once when the listener's path pattern matches current url pathname and the route was not previously activated
        },
        update(ev) {
            // calls when captured parameters changes, or when url search param (query) changes or url hash changes
            // The route must by activated (entered first) before update can be called
        },
        exit(ev) {
            // Calls when current url pathname doesn't match the listener's path pattern given that the route listener was activated previously
        }
    }
)
```
### Capture pattern for path
```js
// For simple static address
"/about"
"/home"
"/admin/log-in"

// To capture parameters
"/page/:page_number" // accessed as ev.params.page_number
"/movie/:uid/chapter-:chapter_no"

// Wildcard capture
"/random/*" // captures everything after "/random/", accessed as ev.params["*"]

// Named Wildcard capture
"/random/:random*" // captures everything after "/random/", but accessed as ev.params.random
```
#### Rules to be remembered:
1. Capture-names can contain letters a-z (case insensitive), 0-9 and _ (underscore)
2. Names can start with a number say `:0page`
3. Path inputs will be automatically processed by the router class
```js
// input -> path processed to
"" -> "/"
"///" -> "/"
"/home/" -> "/home"
"page/:page_no" -> "/page/:page_no"
"/about?lang=en#content-1" -> "/about"
"https://example.com/test" -> "/test" // given same origin as the site
```

### Path ranking
Each path capture patteren will have a fixed score/ranking. Higher scores will be preferred during route selection.
```js
// (Points for each part)
// static-path    4
// :capture       3
// :capture*      2
// *              1
// "/"            0

// Example
// if url path is /about/Saneesh
"/about/Saneesh" // will be preferred
"/about/:name"
```
Calculate Score as follows
```js
"/about/Saneesh"
4 + 4 = 8
"/about/:name"
4 + 3 = 7
```
### enter() method
```js
enter(ev) {
    // ev.params object contains the captured value under same name
    // say you captured :name
    console.log(ev.params.name)

    // there are also properties like
    ev.path // the process path (read above)
    ev.normalized_exp // regex expression that is used to match the path (contains capture group), its mainly used by router class
    ev.hash // url hash value
    // -> undefined or string

    ev.query // object that contains all url search params
    // say we go to "/about?name=Saneesh"
    // access it like
    console.log(ev.query.name)

    // Last method (special for enter()-method)
    ev.update() // this directly triggeres the update() method
}
```
### update() method
Say you set a listener for path `about/:name`. When you go to `/about/Saneesh`, enter()-method triggers, then subsequent changes (say `/about/John`) triggers update()
* Note that url must be set using `router.set(<path_string>)` to achieve this SPA effect
```js
update(ev) {
    // same ev prop as enter & exit
    // but a different property changes is there
    ev.changes.params.param_name
    ev.changes.query.query_name
    ev.changes.hash
    // These states if changed can be
    // 1. added
    // 2. updated (params have `updated` state only)
    // 3. removed 

    // Example
    if(ev.changes.query.lang) {
        // Name was changed
        if(ev.changes.params.lang == "updated") updateLang(ev.query.lang)
    }

    // there is another convinient method to track changes
    ev.watch("params", {
        name(value, mode /* always updated for params */) {
            // when ev.params.name changes
        }
    })
    ev.watch("query", {
        lang(value, mode) {
            // code ...
        }
    })
    ev.watch("hash", function(value, mode) {
        // code...
    })
}
```
### exit() method
```js
exit(ev) {
    // Access prop before url updates
    ev.params
    ev.path
    ev.normalized_exp
    ev.query
    ev.hash
    // That's all
}
```
### For redirects
```js
router.redirect(path, destination, noRefresh ? true:false, type_constaints) // false by default

// Example
router.redirect("/", "/home", true) // static redirect
router.redirect(":name/:age", ":name?age=:age") // say /Saneesh/18 goes to /Saneesh?age=18
router.redirect(":name/:age", (ev) => {
    return `${ev.params.name}?age=${ev.params.age}`
})
```
* Note: for type_constaints you need to read TypedKentRouter part
```js
// vague example
// look the next TypedKentRouter section for reference
router.redirect(path, destination, noRefresh, {
    params: {
        name: {
            // ...
        }
    },
    // ...
})
```
### 404-routes
```js
router.notFound(
    {
        enter() {
            // Do something
            // like show a 404 component
        },
        exit() {
            // useful while using .set()
        }
    }
)
```

## TypedKentRouter
### Start Template
```js
import TypedKentRouter from "./router.typed.js"

const router = new TypedKentRouter()
// listeners ...
router.init()
```
### Extended features to listener
```js
router.listen(
    {
        path: ":example",
        params: {
            example: {
                type: "<type_code>",
                // other properties associated with the type
            }
        },
        query: {
            // all value changes refelected immediately in url
            query_name: {
                type: "<type_code>",
                // other properties associated with the type
                required: true | false, // optional (false by default)
                default: "<value>", // default value if not present (no type checks)
                fallback: "<value>", // if type check fails
                transform(value) {
                    // Transform query value before call
                    return "<value>"
                }
            }
        },
        enter(ev) {
            // ...
        },
        update(ev) {
            // ...
        },
        exit(ev) {
            // ...
        }
    }
)
```
### Type Code and Score
```js
enum    4
uuid    3
int     2.5
number  2
slug    1.5
string  1
```
### Properties associated with types
#### For enum:
```js
values: [/** strings or numbers **/]
case_insensitive: true | false // optional, false by default
```
* Note: type check fails if value is not included in values

Example:
```js
router.listen(
    {
        path: ":week_day",
        params: {
            week_day: {
                type: "enum",
                values: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
            }
        },
        enter: e=> e.update()
        update(e) {
            console.log("Today is", e.params.week_day)
        }
    }
)

router.set("/Sunday") // consoles `Today is Sunday`
router.set("/Saneesh") // nothing...
```
#### For number and int
```js
// example
allowed: [10, 20, 30, { min: 30, max: 40, min_inclusive: false, max_inclusive: false}]
denied: [35, { min: 31, max: 33 }]
// min_inclusive and max_inclusive are true by default
```
The above example should select only values `10,20,30,34,36-39`
* Note: denied is more important than allowed
### Example with types on query
```js
router.listen(
    {
        path: "/home",
        query: {
            lang: {
                type: "enum",
                values: ["en", "en-in", "jp"],
                default: "en",
                fallback: "en"
            }
        }
        enter: e=> e.update()
        update(e) {
            if(e.changes.query.lang) {
                updateLanguagePrefs(e.query.lang)
            }
        }
    }
)

router.set("/home") // sets page to /home?lang=en
router.set("/home?lang=es") // sets page to /home?lang=en
router.set("/home?lang=jp") // sets page to /home?lang=jp
```

## Dev note
Any changes, optimisations and feature suggestion can be disccussed!

~ Yours, Saneesh
