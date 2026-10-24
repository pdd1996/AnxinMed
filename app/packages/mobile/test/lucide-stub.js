/**
 * Jest 替身：lucide-react-native 的 dist 是 ESM，jest 默认不转 node_modules。
 * 图标不参与文本断言，用空 View 代替；通过 jest.config.js 的 moduleNameMapper 全局生效。
 */
const React = require("react");
const { View } = require("react-native");

const StubIcon = (props) => React.createElement(View, props);
module.exports = new Proxy({}, { get: () => StubIcon });
