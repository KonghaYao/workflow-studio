# Fenix 本地调试对象存储

`docker-compose-debug.yml` 的对象存储服务使用 RustFS，桶初始化使用 Bitnami minio-client。保留 `minio` 服务名、`coze-minio` 容器名、9000/9001 端口及现有 `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` 配置入口，业务方仍通过 S3 协议访问。

## 数据与回滚边界

- 此变更只适用于本地 debug 编排，不修改生产编排，不执行数据迁移。
- `./data/minio` 是当前 debug 存储目录；S3 协议兼容不代表底层数据文件兼容。已有 MinIO 数据时，先备份并为 RustFS 准备独立的空目录，再通过 S3 工具迁移对象；不得直接切换镜像并复用原数据目录。
- 回滚时恢复原镜像与对应的数据备份，RustFS 新写入的对象需要另行迁移；仅撤回 Compose 文件不能保证数据回滚。
- 两个镜像目前使用 `latest`，升级前应记录实际镜像摘要并验证；本次检查不承诺后续 `latest` 的行为相同。

## 验证

```bash
docker compose --env-file docker/.env.debug -f docker/docker-compose-debug.yml config --quiet
docker inspect coze-minio --format '{{.State.Health.Status}}'
docker inspect coze-minio-setup --format '{{.State.Status}} {{.State.ExitCode}}'
```

2026-09-30 对已有本地容器只读检查：Compose 校验通过，存储容器为 `healthy`，初始化容器为 `exited 0`。未重新启动容器、重新执行初始化或修改现有对象；这些结果不替代完整的业务读写、Milvus 集成及数据迁移验收。
