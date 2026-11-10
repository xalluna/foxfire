/** A page or a script bundled as text. */
declare module '*.html?raw' {
  const content: string
  export default content
}

declare module '*.js?raw' {
  const content: string
  export default content
}
