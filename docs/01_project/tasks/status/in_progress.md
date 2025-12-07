# 進行中タスク
- デバッグUIを react-three-fiber 側に移動して本番相当の UX を構築
  - three-vrm の表示コンテキスト上に diagnostics/latency 可視化やプロバイダ切替 UI を統合し、実運用に近い UI/UX を提供する。
  - 既存の debug パネル（shadcn/ui）からの移設と、パフォーマンスへの影響確認（scene レンダリング負荷、イベント伝搬）を含める。
