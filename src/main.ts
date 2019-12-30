
type Expr =
  | { kind: '==', left: Expr, rigth: Expr }
  | { kind: 'includes', left: Expr, rigth: Expr }
  | { kind: '&&', left: Expr, rigth: Expr }
  | { kind: 'val', value: any }
  | { kind: 'acs', id: string }

interface IFilterable<T extends object> {
  Where(p: (i: Builder<T>) => BoolExprBuilder): IFilterable<T>
  ToArray(): T[]
}

interface IAsyncFilterable<T extends object> {
  Where(p: (i: Builder<T>) => BoolExprBuilder): IAsyncFilterable<T>
  ToArray(): Promise<T[]>
}

const FromSync = <T extends object>(f: IFilterable<T>): IAsyncFilterable<T> => ({
  Where: p => FromSync(f.Where(p)),
  ToArray: () => Promise.resolve(f.ToArray())
})

const runExpr = <T>(e: Expr, i: any): any => {
  if (e.kind == 'acs') return i[e.id]
  if (e.kind == '==') return runExpr(e.left, i) == runExpr(e.rigth, i)
  if (e.kind == 'includes') return runExpr(e.left, i).contains(runExpr(e.rigth, i))
  if (e.kind == '&&') return runExpr(e.left, i) && runExpr(e.rigth, i)
  if (e.kind == 'val') return e.value
}

const FromArray = <T extends object>(a: Array<T>): IFilterable<T> => {
  const exprs: Expr[] = []
  const value = [...a]

  return {
    Where(predicate) {
      exprs.push(predicate(builder()).getExpr())
      return this
    },
    ToArray() {
      return exprs.reduce((res, e) => res.filter(i => runExpr(e, i)), value)
    }
  }
}

const compileOdata = (e: Expr): string => {
  if (e.kind == 'acs') return e.id.toString()
  if (e.kind == '==') return `${compileOdata(e.left)} eq ${compileOdata(e.rigth)}`
  if (e.kind == 'includes') return `substringof( ${compileOdata(e.rigth)}, ${compileOdata(e.left)})`
  if (e.kind == '&&') return `${compileOdata(e.left)} and ${compileOdata(e.rigth)}`
  if (e.kind == 'val') return typeof e.value == 'string' ? `'${e.value}'` : e.value
}

const odata = <T extends object>(name: string, baseuri = '/odata'): IAsyncFilterable<T> => {

  const exprs: Expr[] = []

  return {
    Where(e) {
      exprs.push(e(builder()).getExpr())
      return this
    },
    async ToArray() {
      const res = await fetch(
        `${baseuri}/${name}?$filter=${exprs.map(runExpr).join(' and ')}`
      )
      const json = await res.json()
      return json.value
    }
  }
}

const handler = {
  get(_, name: string) {
    return new ExprBuilder({
      kind: 'acs',
      id: name
    })
  },
};

const builder = <T extends object>() => new Proxy<T>({} as any, handler);

interface Blog {
  Id: number
  Title: string
}

class ExprBuilder {
  constructor(public readonly ast: Expr) { }

  getExpr = () => this.ast

  equals(v: string | number | boolean | ExprBuilder) {
    if (['string', 'number', 'boolean'].indexOf(typeof v) != -1) {
      return new ExprBuilder(createBinaryExpression('==', this.ast, createValExpression(v)))
    }

    return new ExprBuilder(createBinaryExpression('==', this.ast, (v as ExprBuilder).getExpr()))
  }

  and(e: ExprBuilder) {
    return new ExprBuilder((createBinaryExpression('&&', this.ast, e.getExpr())))
  }

  includes(e: ExprBuilder | string) {
    if (typeof e == 'string')
      return new ExprBuilder(createBinaryExpression('includes', this.ast, createValExpression(e)))
    return new ExprBuilder(createBinaryExpression('includes', this.ast, e.getExpr()))
  }
}

const createValExpression = <T>(v: any): Expr => ({
  kind: 'val',
  value: v
})

const createBinaryExpression = <T>(kind: '==' | 'includes' | '&&', left: Expr, rigth: Expr): Expr => ({
  kind, left, rigth
})

interface StringExprBuilder {
  equals(s: string | StringExprBuilder): BoolExprBuilder
  includes(s: string | StringExprBuilder): BoolExprBuilder
  getExpr(): Expr
}

interface BoolExprBuilder {
  equals(s: boolean | BoolExprBuilder): BoolExprBuilder
  and(e: BoolExprBuilder): BoolExprBuilder
  getExpr(): Expr
}

interface NumberExprBuilder {
  equals(s: number | NumberExprBuilder): BoolExprBuilder
  getExpr(): Expr
}

type Builder<T extends object> = {
  [k in keyof T]: T[k] extends string ? StringExprBuilder :
  T[k] extends number ? NumberExprBuilder :
  BoolExprBuilder
}

interface Blog {
  Id: number
  Title: string
}

FromArray<Blog>([
  { Id: 1, Title: 'Blog 1' },
  { Id: 2, Title: 'Blog 2' },
  { Id: 3, Title: 'Blog 3' },
])
  .Where(b => b.Id.equals(1).and(b.Title.includes('Hello')))
  .ToArray()
