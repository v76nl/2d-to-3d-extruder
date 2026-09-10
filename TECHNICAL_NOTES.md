# 技術ノート: Web 3D と 3D プリントの互換性

> ブラウザベースの 2D-to-3D キーホルダー生成ツール **xtrudy** の開発から得られた知見。
> トピック: Three.js、opentype.js、Clipper2、STL エクスポート、スライサーの挙動、多様体 (マニフォールド) ジオメトリ。

---

## 1. 座標系の差異

### Three.js と OpenType / SVG

| 体系 | Y 軸の向き |
|------|-----------|
| Three.js (および WebGL) | **Y-up**: Y は上に向かって増加 |
| OpenType / SVG | **Y-down**: Y は下に向かって増加 |

`opentype.js` (`font.getPath(...)`) から取得したグリフのパスコマンドをそのまま `THREE.ExtrudeGeometry` に渡すと、生成される形状は**上下反転 (垂直ミラー)** し、文字が上下逆に表示される。

**対策:** 押し出し後に `geometry.scale(1, -1, 1)` を適用する。ただし、負のスケールを適用するとすべての三角形の巻き順 (winding order) が反転し、面の法線が裏返ってしまう。そのため、直後に三角形のインデックス順序を入れ替えて正しい法線に戻す必要がある。

```javascript
// flipYCorrectly: Y 軸をスケール反転し、三角形の巻き順を修正して法線を復元する
function flipYCorrectly(geometry, scaleX = 1, scaleY = -1, scaleZ = 1) {
    geometry.scale(scaleX, scaleY, scaleZ);
    if (scaleX * scaleY * scaleZ < 0) {
        // インデックス付きジオメトリの場合: 各三角形で index[i] と index[i+2] を入れ替える
        // インデックスなしジオメトリの場合: 各三角形の3頂点組で 頂点0 と 頂点2 を入れ替える
        geometry.computeVertexNormals();
    }
}
```

> **重要ルール:** 3 つのスケール成分の積が負になる場合は常に三角形の巻き順が反転するため、法線を再計算しなければならない。

---

## 2. Three.js ExtrudeGeometry の内部仕様

### 押し出し方向

`THREE.ExtrudeGeometry(shape, { depth: d })` は **+Z 方向** に押し出す:

- 後面キャップ (形状面): `z = 0`、法線方向は **-Z**
- 前面キャップ: `z = depth`、法線方向は **+Z**
- 側面壁: 後面キャップと前面キャップを接続する壁

### キャップと穴

`THREE.Shape` に穴が存在する場合 (`shape.holes.push(holePath)` 経由)、`ExtrudeGeometry` は:

- イアクリッピング法 (`THREE.ShapeUtils.triangulateShape`) を使ってキャップを三角形分割する
- 各穴の境界に対して内側の側面壁を生成する

### 側面壁のテセレーション

側面壁は、形状の曲線を `curveSegments` の間隔 (デフォルト 12) でサンプリングすることで生成される。
サンプリングされた各点は、`z=0` から `z=depth` を結ぶ四角形 (2 つの三角形) を形成する。つまり:

- **側面壁の頂点の XY 座標 = 形状のサンプリング点**
- 2 つの形状が同じ境界点を共有している場合 (例: 同じ Clipper 出力から得られた形状)、それらの側面壁は**完全に同一の XY 位置**に配置される。両者が同じ Z 範囲にわたって押し出された場合、一致ジオメトリ (重なり) の原因となる。

---

## 3. フォントパスから 3D へのパイプライン

### opentype.js のパスコマンド

`font.getPath(char, x, y, size).commands` は以下の配列を返す:

| コマンド | 意味 |
|---------|------|
| `M x y` | 移動 (新しいサブパスを開始) |
| `L x y` | 直線描画 |
| `Q x1 y1 x y` | 2次ベジェ曲線 |
| `C x1 y1 x2 y2 x y` | 3次ベジェ曲線 |
| `Z` | パスを閉じる |

各 `M` コマンドは新しい輪郭 (contour) を開始する。単一のグリフ (例: 「A」) は通常、以下を持つ:

- 1 つの外側輪郭 (文字の輪郭線)
- 1 つ以上の内側輪郭 (穴 / カウンター、例: 「A」の内側の三角形)

### THREE.Shape への変換

```javascript
commands.forEach(cmd => {
    switch(cmd.type) {
        case 'M': currentShape = new THREE.Shape(); currentShape.moveTo(cmd.x, cmd.y); break;
        case 'L': currentShape.lineTo(cmd.x, cmd.y); break;
        case 'Q': currentShape.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y); break;
        case 'C': currentShape.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break;
        case 'Z': currentShape.closePath(); break;
    }
});
```

### 穴の割り当て

グリフから得られた素の形状は、点ポリゴンの**符号付き面積 (signed area)** に基づいて**塗り (solid)** または**穴 (hole)** として分類する必要がある:

```javascript
const area = THREE.ShapeUtils.area(pts);
// 正の面積 => 反時計回り (CCW) => 塗り (外側輪郭)
// 負の面積 => 時計回り (CW) => 穴 (内側輪郭)
```

Clipper2 のブーリアン Union 実行後は、最大面積の輪郭が主要な塗りとなり、逆符号を持つより小さな輪郭が穴となる。各穴は、それを内包する塗りに割り当てる必要がある (バウンディングボックスの重心包含判定を使用)。

---

## 4. パスのブーリアン演算を行う Clipper2 (clipper2-js)

### なぜ必要なのか

「X」「O」「B」などのフォントには、**自己交差**または**ネストした**サブパスが存在する。これらを単純に押し出すと、重複領域が内部に余分な壁を作り出し、非多様体 (ノンマニフォールド) ジオメトリとなってスライサーでエラーを引き起こす。

### 整数座標系

Clipper2 は **64ビット整数** のみで動作する。浮動小数点の座標はスケール変換が必要である:

```javascript
const CLIPPER_SCALE = 1e6; // 1単位 = 1マイクロメートル

// 浮動小数点 -> Clipper 整数
{ x: Math.round(floatX * CLIPPER_SCALE), y: Math.round(floatY * CLIPPER_SCALE) }

// Clipper 整数 -> 浮動小数点
floatX = pt.x / CLIPPER_SCALE;
```

### 主要な演算

```javascript
import { Clipper, Paths64, FillRule } from 'clipper2-js';

// Union (和): すべてのサブパスを結合し、自己交差のないクリーンな輪郭を生成する
const unified = Clipper.Union(paths, undefined, FillRule.NonZero);

// Difference (差): 形状 A から形状 B を切り抜く
const result = Clipper.Difference(pathsA, pathsB, FillRule.NonZero);
```

### FillRule.NonZero

- **NonZero (全回転数ルール)**: 巻き数が 0 でない場合を内部とみなす (フォントの標準)
- **EvenOdd (奇偶ルール)**: 境界を横切るたびに内部 / 外部を交互に切り替える (大半のフォントには不適切)

### Clipper を用いた典型的なフォントパイプライン

1. 全文字のパスを解析 => 素のサブパスを取得 (この時点では穴割り当ては未実施)
2. すべてのサブパスを `Paths64` に変換
3. `Clipper.Union(allPaths, undefined, FillRule.NonZero)` => クリーンな輪郭を生成
4. `paths64ToThreeShapes()` => 面積の符号によって塗りと穴を分類
5. クリーンアップされた `THREE.Shape[]` を `ExtrudeGeometry` に渡す

---

## 5. 多様体 (マニフォールド) ジオメトリ: 定義と要件

### 多様体メッシュとは何か？

**多様体 (マニフォールド)**、別名「ウォータータイト (水密)」メッシュは以下の条件を満たす:

1. すべてのエッジが**ちょうど2つ**の三角形によって共有されている
2. 頂点を取り囲むすべての三角形が、枝分かれのない1つの接続された「ファン」を形成している
3. 内側を向く面法線が存在しない (一貫した外向きの巻き順)

### メッシュが非多様体になる要因

| 問題 | 説明 | スライサーへの影響 |
|------|------|-------------------|
| **T接合 (T-junction)** | メッシュ A のエッジがメッシュ B の面の内部に接触している | プリント物に穴が空く |
| **背中合わせの一致面 (Coincident opposite-face)** | 同じ位置にあり法線が逆向きの2つの三角形 | 空洞 (void) 領域となる |
| **非多様体エッジ (Non-manifold edge)** | 3つ以上の三角形が同一のエッジを共有している | 内部 / 外部が未定義となる |
| **開いた境界 (Open boundary)** | エッジに隣接する三角形が1つしかない | シェルに穴が空く |

### スライサーによる非多様体ジオメトリの処理

スライサーは各層で内外判定を行うために**レイキャスティング**または**巻き数判定 (winding number)** アルゴリズムを使用する。背中合わせの一致面が存在すると、レイの交差カウントが相殺され、スライサーはその領域を**外部**として判定してしまう => 何もプリントされない (空洞化)。

---

## 6. 面の共有 / 側面壁の一致問題

### xtrudy で実際に発生したバグ

**不具合のあった設計:**

- テキスト柱: XY = テキストの専有領域、Z = `-baseThickness` 〜 `+modelThickness`
- ベースリング (ドーナツ形状): XY = `ベース輪郭からテキスト領域を除算したもの`、Z = `-baseThickness` 〜 `0`

両ジオメトリとも、`z = -baseThickness` から `z = 0` の間でテキスト境界の側面壁を生成する:

| ジオメトリ | 側面壁の位置 | 法線の向き |
|-----------|-------------|-----------|
| テキスト柱の外側壁 | テキスト領域の境界 | 外側を向く |
| ベースリングの内側壁 (穴の壁) | 同じテキスト領域の境界 | 内側を向く |

=> **全く同一の XYZ 位置**に**逆向きの法線**を持つ 2 組の三角形が存在することになる。

### なぜ mergeGeometries + mergeVertices で悪化したのか

```javascript
const merged = mergeGeometries(geometries, false); // すべての三角形を結合
const cleaned = mergeVertices(merged, 1e-4);        // 重複頂点をマージ
```

`mergeVertices` を実行すると、背中合わせの三角形同士が**頂点を共有**するようになり、非多様体エッジ (1つのエッジを3つ以上の三角形が共有) が発生する。スライサーはこれをプリントモデル内の空洞として認識してしまう。

### 解決策: Z 範囲を完全に分離する

```
修正後:
z = +modelThickness  +----------+
                     | テキスト |  <- シェル 1 (z=0 〜 +model)
z = 0           -----+          +--------- (エッジのみの接触、面の重なりなし)
                +----+----------+----+
                | ベースリング (ドーナツ) |  <- シェル 2 (z=-base 〜 0)
z = -baseThick  +--------------------+
```

- テキスト柱: `depth = modelThickness` のみ、z=0 から開始 (Z 平行移動不要)
- ベースリング: 変更なし (z=-base 〜 0)
- Z 範囲の重複がない => **側面壁の一致が発生しない**

### エクスポート: シェルをマージしない

```javascript
// 誤り: マージすると一致壁が生成され => 非多様体になる
const merged = mergeGeometries(geometries);
const cleaned = mergeVertices(merged);

// 正しい: rootGroup をそのままエクスポートし、スライサー側にシェルの結合を任せる
const result = exporter.parse(rootGroup, { binary: true });
```

---

## 7. STL ファイルにおける複数シェル

### STL フォーマットの基礎

バイナリ STL は三角形のフラットなリストである。「シェル」や「オブジェクト」という概念はなく、単なる三角形の集合に過ぎない。Three.js シーン内の複数のメッシュは、すべて1つのリストとしてエクスポートされる。

```
[80バイトのヘッダー][uint32: 三角形数]
[各三角形: 法線(3xfloat32) + v1(3xfloat32) + v2(3xfloat32) + v3(3xfloat32) + 属性(uint16)]
```

### スライサーによる複数シェルの解釈

現代のスライサー (ideamaker、PrusaSlicer、Cura など) は、**ブーリアン Union (和)** によって複数シェルを解釈する:

- 各閉曲面が独立したシェルとして検出される
- 全シェルの和集合 (Union) がプリント可能な立体として扱われる
- エッジのみを共有し、面を共有していない隣接シェルは正しく結合される

これこそが `mergeGeometries` を使わずにエクスポートしても正常に機能する理由である。各パーツは独立したクリーンなシェルとして維持され、スライサー側で適切に結合される。

### マージが有効となるケース

マージが有効なのは**以下の条件のみ**である:

- メッシュ同士が境界ジオメトリを一切共有していない (完全に分離しており、接触していない)
- スライサーのパフォーマンス向上のためにシェル数を減らしたい場合
- 頂点位置が完全に一致していることが分かっている箇所で、T接合を解消するために `mergeVertices` を使用する場合

---

## 8. Three.js からの STL エクスポート (STLExporter)

### exporter.parse(object, { binary: true })

- シーングラフを走査し、すべての `Mesh` オブジェクトを含める
- 各三角形に対して、メッシュの `matrixWorld` を適用してワールド空間に変換する
- 外積を用いて頂点座標から面法線を計算する: `normal = (b-a) x (c-a)`

### 負のスケール (mirrorX) の落とし穴

`Group` に `scale.x = -1` が設定されている場合 (例: ハンコ・スタンプ用途の左右反転):

- `applyMatrix4(matrixWorld)` は負のスケールを頂点座標に焼き込む
- これにより**三角形の巻き順が反転する**
- STLExporter は反転した巻き順から法線を再計算するため、法線が内側を向いてしまう
- 多くのスライサーには「法線の自動修正」オプションがあるが、確実とは言えない

**対策:** 複製したジオメトリに負のスケール行列を適用した後、エクスポート前に三角形のインデックスを反転させる。またはスライサーの法線修正機能に委ねる。

### エクスポート前の computeVertexNormals()

STL エクスポートの前に `geometry.computeVertexNormals()` を呼び出しても、**STL の法線には何の影響も与えない**。`STLExporter` は頂点座標から面ごとの法線を独自に再計算するためである。このメソッドが影響するのは Three.js ビューポートのレンダリング (スムーズシェーディング) のみである。

---

## 9. 3D プリント用のリング / トーラスのジオメトリ

### 中空円柱 (プリント適性の高いストラップリング)

`THREE.TorusGeometry` (円形断面を持つソリッドトーラス) の代わりに、環状の 2D 断面を Z 方向に押し出した中空円柱を生成する:

```javascript
const shape = new THREE.Shape();
shape.absarc(0, 0, outerR, 0, Math.PI * 2, false); // 外側の円 (反時計回り CCW)
const hole = new THREE.Path();
hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);    // 内側の円 (時計回り CW = 穴)
shape.holes.push(hole);
const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: cylHeight, bevelEnabled: false, curveSegments: 32
});
```

これにより、上下の面が平坦な多様体中空円柱が生成され、断面が円形である `TorusGeometry` よりも 3D プリントに適した形状となる。

### リング補強板

リングとベース板を接続する「ヒレ (リブ)」状のパーツ。リングのローカル 2D 空間で形状が計算される:

- **ケース A:** ベース上辺がリングの外周円と交差する場合 => 円弧 + 弦の形状
- **ケース B:** ベース上辺が完全にリングの下にある場合 => 矩形 + 半円弧の形状

---

## 10. Z 座標の配置戦略

### 座標の規則

| パーツ | Z 範囲 | 備考 |
|--------|--------|------|
| テキスト柱 | `0` 〜 `+modelThickness` | ベースの上に突き出る |
| ベースリング (ドーナツ) | `-baseThickness` 〜 `0` | 上面よりも下に位置する |
| リング (中空円柱) | 中心が `-baseThickness / 2` | ベースの Z 範囲の中央 |
| リング補強板 | リングと同じ中心 Z | リングと一致させる必要がある |

ベースを負の Z、テキストを正の Z に配置することで、`z=0` がベースの上面 / テキストの底面となる。これが自然な基準面となり、2つのパーツ間における Z 方向の重複を完全に回避できる。

---

## 11. 巻き順検出のための THREE.ShapeUtils.area()

```javascript
const area = THREE.ShapeUtils.area(points); // points: THREE.Vector2[]
// 正の面積 => 反時計回り => 塗り (Three.js の規約における外側輪郭)
// 負の面積 => 時計回り => 穴 (内側輪郭)
```

Clipper2 の Union 後、最外郭の輪郭の巻き順は Clipper の出力規約によって決定される。常に最初の (最大面積の) 輪郭の符号を実測し、それを「塗り」の符号として扱うこと。

---

## 12. まとめ: 3D プリント可能な多様体ジオメトリのルール

1. **隣接する立体同士で面を共有しない。** 接触する 2 つの立体はエッジのみを共有すべきであり、同じ XY 領域かつ同じ Z 平面上で面を共有してはならない。

2. **背中合わせの一致面を作らない。** 2 つの三角形が逆向きの法線を持って同一平面を占有している場合、スライサーはその領域を空洞として判定する。

3. **可能な限りパーツごとに Z 範囲を分離する。** 側面壁の一致を避ける最も確実な方法は、隣接する押し出しパーツの Z 範囲を重複させないことである。

4. **マージせず、複数の独立したシェルとしてエクスポートする。** 入力メッシュ同士に共有の境界ジオメトリが存在しない場合を除き、`mergeGeometries + mergeVertices` を使用するのは危険である。

5. **フォントパスは押し出し前に Clipper2 の Union を適用する。** フォントのサブパスは自己交差することがある。3D メッシュ化した後に修正するよりも、2D の段階でブーリアン Union を行う方が低コストかつ確実である。

6. **負のスケール適用後は巻き順を修正する。** 3 つのスケール因数の積が負になる場合は、常に三角形のインデックス順序を反転させる。

7. **Three.js ビューポートだけでなくスライサーで STL を検証する。** Three.js では DoubleSide マテリアルを使用することが多く、巻き順や法線のエラーが見落とされやすい。スライサーは法線に対して厳格である。
