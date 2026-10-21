# 美术资源与来源

依据原版双人完整试玩，保留四人牌桌与角色身份，增强暗色酒馆的木材、织物、纸张、金属和暖色照明。参考了 [Liar's Bar 官方页面](https://store.steampowered.com/app/3097560/Liars_Bar/) 的氛围，没有使用其游戏贴图或截图。

所有运行资源均在 `public/` 内，不依赖外站热链或在线字体。

| 资源 | 来源 | 许可与处理 |
| --- | --- | --- |
| `assets/tavern.webp` | imagegen 内置工具生成 | 新生成酒馆环境，1536×1024，268,102 字节 |
| `assets/revolver.webp` | imagegen 内置工具生成 | 新生成道具，768×512，72,984 字节，保留透明通道 |
| `assets/textures/walnut.jpg`、`walnut.webp` | [Poly Haven / Wood Table 001](https://polyhaven.com/a/wood_table_001) | [CC0](https://polyhaven.com/license)，保留原始 JPG，生成 768×768 WebP |
| `assets/textures/weave.jpg`、`weave.webp` | [Poly Haven / Fabric Pattern 05](https://polyhaven.com/a/fabric_pattern_05) | CC0，使用粗糙度图体现织物纹理，生成 512×512 WebP |
| `assets/icons/*.svg` | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/tree/0.468.0/icons) | 原始许可随附于 `assets/icons/LICENSE` |
| `portraits/*.svg`、`favicon.svg` | 原项目 | 保留原资源与身份，不变更其权利归属 |

环境、木纹、织物三个实际运行贴图共约 385 KiB；道具约 71 KiB。PNG 原稿保存在本地 `.qa/art-sources/`，不进入公开页面请求。

`scripts/prepare-assets.cjs` 通过浏览器 Canvas 编码资源。生成使用 imagegen 内置工具，未使用 CLI/API 回退方式。透明道具已验证空白区域 alpha 为 0，主体接近不透明；浏览器验收还会重新检查透明通道和全部资源解码。

## 酒馆环境的完整生成提示词

```text
Use case: stylized-concept. Asset type: environment background for an existing web card game called Liar's Bar. Create one polished cinematic wide landscape environment image, 1536x1024 or wider landscape. A sophisticated dim 1920s clandestine tavern interior, dark walnut wall panels and carved wooden bar, warm brass shaded lamps, amber practical lights reflecting on aged wood, subtly smoky atmospheric depth, deep evergreen velvet and dark leather seats, subdued burgundy accents. Viewed from seated eye level across an intimate green felt card table. Table occupies only the lower quarter, walls and bar recede in the distance, composition has a calm dark central area suitable for a gameplay surface to be drawn over it. Rich physically plausible wood grain, worn brass edges, leather pores, soft woven felt, tasteful subtle imperfections. Focus on believable material rendering and warm chiaroscuro, not a flat gradient. Art direction: premium indie tabletop game, beautifully lit 3D game environment. No people, no characters, no text, no logos, no lettering, no weapons, no playing cards, no UI, no collage, no watermark. This is a single environment backdrop, not a screenshot mockup.
```

## 处决道具的完整生成提示词

```text
Use case: stylized-concept. Asset type: a single transparent game prop sprite for a premium cinematic web card game, side-on antique revolver. Create one isolated high-quality hand-painted realistic 3D-rendered revolver, barrel pointing LEFT, grip on the RIGHT and downward. Fully contained within image with generous transparent margin, landscape 3:2 composition. Slight 3/4 side profile, nearly orthographic, horizontal upper barrel. Aged brushed gunmetal steel, fine machined metal edges, subtle engraving without lettering, warm worn dark walnut grip with clear wood grain, tiny brass accents, physically believable metal roughness. Broad visible cylinder at approximately 60% of image width and 42% height, unmarked side surface rather than a face full of chamber holes. Clean strong silhouette readable when displayed at 300 pixels wide. Warm soft tavern key light from upper left and faint cool rim light, crisp detail, restrained premium game asset art, no glowing effects. The entire gun should be in focus. No hand, no person, no bullets, no cartridges, no ammunition, no firing, no muzzle flash, no smoke, no floor, no scenery, no cast shadow outside the object, no text, no watermark, no frame. Genuine alpha-transparent background, not a checkerboard pattern.
```
