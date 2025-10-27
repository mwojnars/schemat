/*
    Loading of client-side packages and static resources.
*/


export class Resources {
    /*
    Google Fonts to use for admin panel:
    - Raleway -- for headers
    - Lato/Nunito/Roboto -- for keys (bold/italic, 700/900) in data tables; Nunito is more rounded
    - Manrope -- for normal text
    monospace:
    - Noto Sans Mono -- Google font that supports all languages; similar to DejaVu Sans Mono, more bars in glyphs
    - opt: Source Code Pro, Courier Prime, Roboto Mono
    other:
    - Montserrat -- is too wide and decorative, could be for user pages
    - Quattrocento Sans -- could work for normal text; must use +1/2px font size;
     */

    // assets to be loaded in the browser
    static clientAssets =
    `
        <!-- Google Fonts... TODO: merge URLs into one-->
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap" rel="stylesheet"> 
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,300;0,400;0,500;0,700;0,900;1,400;1,500&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900&display=swap" rel="stylesheet"> 
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Mono:wght@400;500;700&display=swap" rel="stylesheet">
        <!--<link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500;700&display=swap" rel="stylesheet">-->
        <!--<link href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">-->
        <!--<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">-->
        <!--<link href="https://fonts.googleapis.com/css2?family=Quattrocento+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">-->
        <!--<link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap" rel="stylesheet">--> 

        <!-- jQuery -->
        <!--<script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js" integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=" crossorigin="anonymous"></script>-->

        <!-- React JS -->
        <!--<script src="https://cdn.jsdelivr.net/npm/react@17.0.2/umd/react.production.min.js" integrity="sha256-Ipu/TQ50iCCVZBUsZyNJfxrDk0E2yhaEIz0vqI+kFG8=" crossorigin="anonymous"></script>
            <script src="https://cdn.jsdelivr.net/npm/react-dom@17.0.2/umd/react-dom.production.min.js" integrity="sha256-nbMykgB6tsOFJ7OdVmPpdqMFVk4ZsqWocT6issAPUF0=" crossorigin="anonymous"></script>-->
        <!--<script src="https://unpkg.com/react@17/umd/react.development.js" crossorigin></script>
            <script src="https://unpkg.com/react-dom@17/umd/react-dom.development.js" crossorigin></script>-->
        <!--<script src="/$/local/node_modules/react/umd/react.development.js" crossorigin="anonymous"></script>
            <script src="/$/local/node_modules/react-dom/umd/react-dom.development.js" crossorigin="anonymous"></script>-->

        <!-- Bootstrap - only use for widgets and in-block layout, not for page layout
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet"> <!--Bootstrap Icons-->
        <!--<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous" />
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"></script>
        <script src="https://unpkg.com/react-bootstrap@next/dist/react-bootstrap.min.js" crossorigin></script> <!--React-Bootstrap-->
        
        <!-- Styled Components
        <script crossorigin src="//unpkg.com/react-is/umd/react-is.production.min.js"></script>   <!-- this dependency should be unneeded in the future
        <script src="https://unpkg.com/styled-components/dist/styled-components.min.js"></script>
        -->
        
        <!-- Material UI -->
        <link href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap" rel="stylesheet"/>    
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet"/>    
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet"/>    
    
        <link href="/$/schemat/assets/favicon.ico" rel="icon" type="image/x-icon" />
        <link href="/$/schemat/assets/styles.css" rel="stylesheet" />
    `
    // inlined favicon:  <link href="data:image/x-icon;base64,AAABAAEAEBAQAAEABAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAgAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAmYh3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBABAQEBAQEBARAQEBAQEBAQAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBABAQEBAQEBARAQEBAQEBAQAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBCqqgAAVVUAAKqqAABVVQAAqqoAAFVVAACqqgAAVVUAAKqqAABVVQAAqqoAAFVVAACqqgAAVVUAAKqqAABVVQAA" rel="icon" type="image/x-icon" />
}

/*
Global CSS class names introduced by the assets above. Watch for name collissions with the styles of Schemat components:

Material Icons -- two classes:
  .material-icons
  .material-icons-outlined

Bootstrap, Bootstrap Icons -- large number of different classes; TODO: drop this dependency!
  .bi row ....

*/


/**********************************************************************************************************************/

// IMPORTANT:
// On client, some objects may already be present in globalThis if loaded via <script> tag. However, do always prefer
// import() over <script>. The latter relies on global objects, is isolated from the main code, and runs in
// unpredictable order relative to Schemat and the main application code (!).

export let {React, ReactDOM, MaterialUI} = {}    // = globalThis


if (CLIENT) {
    // IMPORTANT:
    // All imports from node_modules below use UMD (not ESM) modules and return empty objects (!) which CANNOT be assigned directly to a variable!
    // However, each of these modules saves its result in globalThis.* and the result object can be taken from there.
    // Note that React does NOT deliver ESM versions of its packages, that's why we must fall back to UMD modules...
    // The other solution is to import ESM modules from esm.sh website, but this may introduce package version mismatch between
    // the client and the server; plus, there tend to be tiny differences in module layouts that enforce changes in application code.

    function check_unloaded(name) {
        if (globalThis[name]) throw new Error(`${name} already loaded via <script> tag`)
    }
    
    check_unloaded("React")
    await import("/$/bundle/react.js")
    // await import("/$/local/node_modules/react/umd/react.development.js")
    React = globalThis.React
    // console.log('React:', React)

    check_unloaded("ReactDOM")
    await import("/$/bundle/react-dom.js")
    // await import("/$/local/node_modules/react-dom/umd/react-dom.development.js")
    ReactDOM = globalThis.ReactDOM
    // console.log('ReactDOM:', ReactDOM)

    check_unloaded("MaterialUI")
    await import("/$/bundle/material-ui.js")
    // await import("/$/local/node_modules/@mui/material/umd/material-ui.development.js")
    MaterialUI = globalThis.MaterialUI
    // console.log('MaterialUI:', MaterialUI)

    // globalThis.React      = React       = (await import("https://esm.sh/react@18.2.0?dev")).default
    // globalThis.ReactDOM   = ReactDOM    = (await import("https://esm.sh/react-dom@18.2.0?dev")).default
    // globalThis.createRoot  = (await import("https://esm.sh/react-dom@18.2.0/client?dev")).createRoot
    // globalThis.hydrateRoot = (await import("https://esm.sh/react-dom@18.2.0/client?dev")).hydrateRoot
    // globalThis.MaterialUI = MaterialUI  = (await import("https://esm.sh/@mui/material@5.2.6?dev"))
}

if (SERVER) {                                                       // on server...
    React      = (await import("react")).default
    ReactDOM   = (await import("react-dom/server")).default
    MaterialUI = (await import("@mui/material")).default
    // MIcons     = (await import("@mui/icons-material")).default
    // ReactBootstrap = (await import("@mui/material")).default
    // styled     = (await import("styled-components")).default
    //     styled = {...(styled.default || {}), ...styled}             // there's a bug in current distribution that requires such unpacking of double-nested .default
    // console.log("styled:", styled)
    // CSSTransition = (await import("react-transition-group")).CSSTransition
}

// console.log('React/ReactDOM versions: ', React.version, ReactDOM.version)
// console.log('ReactDOM:', ReactDOM)

export default Resources
