/** jest-expo（SDK 57）跑 mobile 组件测试；@/ 别名与 tsconfig 对齐。 */
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.ts?(x)"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^lucide-react-native$": "<rootDir>/test/lucide-stub.js",
    // 工作区包的 TS 源码使用 ESM 风格 `./x.js` 相对引用；Jest 直接读 .ts 源码时去掉 .js 后缀
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // jest-expo 默认不转 node_modules；RNR 的 Slot 与 nativewind 的产物是 JSX/ESM，必须放行。
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@rn-primitives/.*|nativewind|react-native-css-interop|@anxin/.*))",
  ],
};
