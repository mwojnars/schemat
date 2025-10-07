/*
    DRAFT.
    Selected widgets implemented with JSX syntax instead of pure-JS with custom functions (SPAN, DIV, cl() etc).
 */


import {TypeWrapper} from "./type.js";
import {truncate} from "../common/utils.js";
import {JSON_Widget, TypeWidget} from "./widgets.js";


export class TYPE_Widget__ extends JSON_Widget {

    viewer()  { return TypeWidget.prototype.viewer.call(this) }
    view() {
        let {value: type} = this.props
        if (type instanceof TypeWrapper) {
            if (!type.real_type) return "TypeWrapper (not loaded)"
            type = type.real_type
        }
        let dflt = `${type.options.default}`

        return (
            <span>
                {`${type}`}
                {type.options.default !== undefined && (
                    <span className="default" title={`default value: ${truncate(dflt, 1000)}`}>
                        {` (${truncate(dflt, 100)})`}
                    </span>
                )}
                {type.options.info && (
                    <span className="info">
                        {` • ${type.options.info}`} {/* smaller dot: &middot; larger dot: • */}
                    </span>
                )}
            </span>
        )

        // return SPAN(`${type}`,
        //         type.props.default !== undefined &&
        //             SPAN(cl('default'), {title: `default value: ${truncate(dflt,1000)}`}, ` (${truncate(dflt,100)})`),
        //         type.props.info &&
        //             SPAN(cl('info'), ` • ${type.props.info}`),   // smaller dot: &middot;  larger dot: •
        //         )
    }
}

