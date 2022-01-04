/*
    Loading of libraries and static resources.
*/

class Resources {
    /*
    Google Fonts to use for admin panel:
    - Raleway -- for headers
    - Nunito (or Lato) -- for keys (bold/italic, 700/900) in data tables; Nunito is rounded & more readable
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
        <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js" integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=" crossorigin="anonymous"></script>

        <!-- Bootstrap should only be used for widgets and in-block layout, not for page layout -->
        <link  href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous" />
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"></script>
    
        <script src="https://unpkg.com/react@17/umd/react.development.js" crossorigin></script>
        <script src="https://unpkg.com/react-dom@17/umd/react-dom.development.js" crossorigin></script>
        <!--<script src="https://unpkg.com/@mui/material@5.2.6/umd/material-ui.development.js" crossorigin></script>-->
        
        <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/ace.min.js" integrity="sha512-jB1NOQkR0yLnWmEZQTUW4REqirbskxoYNltZE+8KzXqs9gHG5mrxLR5w3TwUn6AylXkhZZWTPP894xcX/X8Kbg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/mode-javascript.min.js" integrity="sha512-37ta5K4KVYs+MEmIg2xnZxJrdiQmBSKt+JInvyPrq9uz7aF67lMJT/t91EYoYj520jEcGlih41kCce7BRTmE3Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-base.min.js" integrity="sha512-+nNPckbKGLDhLhi4Gz1Y1Wj5Y+x6l7Qw0EEa7izCznLGTl6CrYBbMUVoIm3OfKW8u82JP0Ow7phPPHdk26Fo5Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-javascript.min.js" integrity="sha512-hwPBZJdHUlQzk8FedQ6S0eqJw/26H3hQ1vjpdAVJLaZU/AJSkhU29Js3/J+INYpxEUbgD3gubC7jBBr+WDqS2w==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/theme-textmate.min.js" integrity="sha512-VE1d8sDypa2IvfFGVnil5k/xdGWtLTlHk/uM0ojHH8b2RRF75UeUBL9btDB8Hhe7ei0TT8NVuHFxWxh5NhdepQ==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <script>ace.config.set("basePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/")</script>
        
        <!-- Bootstrap icons -->
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css">
        
        <!-- Material UI's font and icons -->
        <link href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap" rel="stylesheet"/>    
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet"/>    
    
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

        <!-- Google Fonts... TODO: merge URLs into one-->
        <link href="https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap" rel="stylesheet"> 
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,300;0,400;0,500;0,700;0,900;1,400;1,500&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Mono:wght@400;500;700&display=swap" rel="stylesheet">
        <!--<link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500;700&display=swap" rel="stylesheet">-->
        <!--<link href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">-->
        <!--<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">-->
        <!--<link href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900&display=swap" rel="stylesheet">--> 
        <!--<link href="https://fonts.googleapis.com/css2?family=Quattrocento+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">-->
        <!--<link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap" rel="stylesheet">--> 

        <!-- local resources... -->
        <script src="/files/assets/libs/material-ui_v5.2.6.development.min.js" crossorigin></script>
          <!--<script src="/files/assets/libs/popper.min.js" crossorigin></script>-->
        
        <link href="/files/assets/favicon.ico" rel="icon" type="image/x-icon" />
        <link href="/files/assets/styles.css" rel="stylesheet" />
    `
    // inlined favicon:  <link href="data:image/x-icon;base64,AAABAAEAEBAQAAEABAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAgAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAmYh3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBABAQEBAQEBARAQEBAQEBAQAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBABAQEBAQEBARAQEBAQEBAQAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBCqqgAAVVUAAKqqAABVVQAAqqoAAFVVAACqqgAAVVUAAKqqAABVVQAAqqoAAFVVAACqqgAAVVUAAKqqAABVVQAA" rel="icon" type="image/x-icon" />
}

let React    = globalThis.React                                     // on client...
let ReactDOM = globalThis.ReactDOM
let MaterialUI = globalThis.MaterialUI
// let CSSTransition = globalThis.CSSTransition

if (!React) {                                                       // on server...
    React    = (await import("react")).default
    ReactDOM = (await import("react-dom/server.js")).default
    MaterialUI = (await import("@mui/material")).default
    // CSSTransition = (await import("react-transition-group")).CSSTransition
}

export { Resources, React, ReactDOM, MaterialUI }
export default Resources
