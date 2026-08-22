# Cài đặt release 2.0.0

Thư mục `release/2.0.0` chứa source ZIP, hai bundle portable Windows x64, năm package tarball và file `SHA256SUMS.txt`.

## Dùng bundle portable — khuyến nghị trên Windows

Giải nén một trong hai file:

- `rn-agent-observer-2.0.0-portable-cli-win-x64.zip`
- `rn-agent-observer-2.0.0-portable-mcp-server-win-x64.zip`

Các bundle đã có production `node_modules`, kể cả native SQLite; không chạy lại `pnpm install`.

```powershell
.\rn-observe.cmd --version
.\rn-observer-mcp.cmd --check
```

## Dùng source archive

1. Giải nén `rn-agent-observer-2.0.0-source.zip`.
2. Cài Node.js 22.12+, pnpm 9.6 và Android Platform Tools.
3. Chạy:

```powershell
pnpm install --frozen-lockfile
pnpm release:check
```

## Package tarball

Các `.tgz` là artifact để audit hoặc publish đồng bộ lên registry nội bộ. Manifest đã chuyển `workspace:*` thành dependency `2.0.0`, vì vậy không cài một tarball riêng lẻ trước khi các package phụ thuộc cùng namespace có trên registry.

Hai bundle portable giữ bản sao tarball cần thiết trong `vendor/` và dùng `pnpm.overrides` nếu cần tái tạo dependency tree cục bộ.

## Xác minh checksum

```powershell
Get-FileHash .\rn-agent-observer-2.0.0-portable-cli-win-x64.zip -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Không publish các package có `private: true` lên registry. Release này là gói bàn giao cục bộ; bỏ `private` chỉ khi đã quyết định registry, namespace và access policy.
