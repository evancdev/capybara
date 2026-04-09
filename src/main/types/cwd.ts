export interface CwdDeps {
  homedir: () => string
  stat: (p: string) => Promise<{ isDirectory: () => boolean }>
  resolve: (...paths: string[]) => string
  /** Resolve symlinks so a symlink inside $HOME cannot escape outside it. */
  realpath: (p: string) => Promise<string>
  sep: string
}
